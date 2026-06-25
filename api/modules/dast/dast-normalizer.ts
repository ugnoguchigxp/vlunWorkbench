import crypto from "node:crypto";
import type { DastProfileDefinition } from "./profiles";
import type {
	DastBrowserRawResult,
	DastHttpRawResult,
	DastNormalizerResult,
	DastRawResult,
	NormalizedDastEvidence,
	NormalizedDastFinding,
	ValidatedDastTarget,
} from "./types";

const SECURITY_HEADERS = [
	"content-security-policy",
	"x-frame-options",
	"x-content-type-options",
];

function fingerprint(parts: string[]): string {
	return crypto.createHash("sha256").update(parts.join("\0")).digest("hex");
}

function createFinding(params: {
	projectId: string;
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	sourceTool: "dast-http" | "dast-browser";
	ruleId: string;
	path: string;
	evidenceKey: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	snippet: string;
	artifactId: string | null;
	metadata?: Record<string, unknown>;
}): NormalizedDastFinding {
	const fp = fingerprint([
		params.projectId,
		params.target.normalizedOrigin,
		params.profile.id,
		params.ruleId,
		params.path,
		params.evidenceKey,
	]);
	return {
		sourceTool: params.sourceTool,
		ruleId: params.ruleId,
		title: params.title,
		description: params.description,
		severity: params.severity,
		confidence: "static",
		primaryLocation: {
			kind: "url",
			origin: params.target.normalizedOrigin,
			path: params.path,
		},
		fingerprint: fp,
		metadata: {
			dastProfileId: params.profile.id,
			targetConfigId: params.target.targetConfigId,
			...params.metadata,
		},
		evidence: [
			{
				kind: "tool-output",
				title: params.title,
				artifactId: null,
				location: {
					kind: "url",
					origin: params.target.normalizedOrigin,
					path: params.path,
				},
				snippet: params.snippet,
				metadata: { ruleId: params.ruleId },
			},
		],
	};
}

function normalizeHttp(params: {
	projectId: string;
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	result: DastHttpRawResult;
	rawArtifactId: string | null;
}): DastNormalizerResult {
	const findings: NormalizedDastFinding[] = [];
	const evidence: NormalizedDastEvidence[] = [];

	for (const response of params.result.responses) {
		evidence.push({
			kind: "http-response",
			title: `HTTP ${response.status ?? "error"} for ${response.path}`,
			artifactId: params.rawArtifactId,
			location: { path: response.path, url: response.url },
			snippet: response.error ?? `status=${response.status}`,
			metadata: { status: response.status, finalUrl: response.finalUrl },
		});

		if (response.status !== null && response.status >= 500) {
			findings.push(
				createFinding({
					projectId: params.projectId,
					target: params.target,
					profile: params.profile,
					sourceTool: "dast-http",
					ruleId: "unexpected-server-error",
					path: response.path,
					evidenceKey: String(response.status),
					title: "Unexpected server error response",
					description:
						"The configured DAST route returned a 5xx response during the bounded HTTP baseline run.",
					severity: "low",
					snippet: `HTTP ${response.status} at ${response.path}`,
					artifactId: params.rawArtifactId,
				}),
			);
		}

		const missing = SECURITY_HEADERS.filter(
			(header) => response.headers[header] === undefined,
		);
		if (response.status !== null && missing.length > 0) {
			findings.push(
				createFinding({
					projectId: params.projectId,
					target: params.target,
					profile: params.profile,
					sourceTool: "dast-http",
					ruleId: "missing-security-header",
					path: response.path,
					evidenceKey: missing.join(","),
					title: "Missing common security header",
					description: `The response is missing common hardening headers: ${missing.join(", ")}.`,
					severity: "info",
					snippet: `Missing headers: ${missing.join(", ")}`,
					artifactId: params.rawArtifactId,
					metadata: { missingHeaders: missing },
				}),
			);
		}

		for (const cookie of response.setCookies) {
			if (!cookie.secure || !cookie.httpOnly || !cookie.sameSite) {
				findings.push(
					createFinding({
						projectId: params.projectId,
						target: params.target,
						profile: params.profile,
						sourceTool: "dast-http",
						ruleId: "weak-cookie-flags",
						path: response.path,
						evidenceKey: cookie.name,
						title: "Cookie is missing recommended security attributes",
						description:
							"A Set-Cookie header was observed without all recommended Secure, HttpOnly, and SameSite attributes.",
						severity: "low",
						snippet: `${cookie.name}: secure=${cookie.secure}, httpOnly=${cookie.httpOnly}, sameSite=${cookie.sameSite}`,
						artifactId: params.rawArtifactId,
						metadata: { cookieName: cookie.name },
					}),
				);
			}
		}

		if (response.headers["access-control-allow-origin"] === "*") {
			findings.push(
				createFinding({
					projectId: params.projectId,
					target: params.target,
					profile: params.profile,
					sourceTool: "dast-http",
					ruleId: "cors-wildcard",
					path: response.path,
					evidenceKey: "access-control-allow-origin:*",
					title: "Wildcard CORS policy observed",
					description:
						"The response sets Access-Control-Allow-Origin to *, which may expose browser-readable responses depending on the endpoint.",
					severity: "low",
					snippet: "access-control-allow-origin: *",
					artifactId: params.rawArtifactId,
				}),
			);
		}

		if (
			["/.env", "/debug"].includes(response.path) &&
			response.status !== null &&
			response.status >= 200 &&
			response.status < 300
		) {
			findings.push(
				createFinding({
					projectId: params.projectId,
					target: params.target,
					profile: params.profile,
					sourceTool: "dast-http",
					ruleId: "sensitive-common-path-exposed",
					path: response.path,
					evidenceKey: String(response.status),
					title: "Sensitive common path is reachable",
					description:
						"A bounded common-path probe returned a successful response for a path that is often sensitive.",
					severity: "low",
					snippet: `${response.path} returned HTTP ${response.status}`,
					artifactId: params.rawArtifactId,
				}),
			);
		}
	}

	const outcome = findings.length > 0 ? "findings" : "passed";
	return {
		findings,
		evidence,
		outcome,
		summary: `HTTP DAST baseline completed with ${findings.length} finding(s) across ${params.result.requestCount} request(s).`,
	};
}

function normalizeBrowser(params: {
	projectId: string;
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	result: DastBrowserRawResult;
	rawArtifactId: string | null;
}): DastNormalizerResult {
	const findings: NormalizedDastFinding[] = [];
	const evidence: NormalizedDastEvidence[] = [];
	for (const route of params.result.routes) {
		for (const message of route.consoleErrors) {
			evidence.push({
				kind: "browser-console",
				title: `Browser console error on ${route.path}`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: route.url },
				snippet: message,
				metadata: {},
			});
		}
		for (const request of route.failedRequests) {
			evidence.push({
				kind: "browser-network",
				title: `Failed browser request on ${route.path}`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: request.url },
				snippet: `${request.method} ${request.url}: ${request.failure}`,
				metadata: {},
			});
		}
		if (route.error) {
			evidence.push({
				kind: "dast-result",
				title: `Browser route error on ${route.path}`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: route.url },
				snippet: route.error,
				metadata: {},
			});
		}
	}
	return {
		findings,
		evidence,
		outcome: "passed",
		summary: `Browser smoke completed for ${params.result.routes.length} configured route(s).`,
	};
}

export function normalizeDastResult(params: {
	projectId: string;
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	result: DastRawResult;
	rawArtifactId: string | null;
}): DastNormalizerResult {
	if (params.result.kind === "http") {
		return normalizeHttp({
			...params,
			result: params.result,
		});
	}
	return normalizeBrowser({
		...params,
		result: params.result,
	});
}
