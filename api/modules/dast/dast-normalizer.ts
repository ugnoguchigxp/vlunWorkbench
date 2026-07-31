import crypto from "node:crypto";
import { evaluateDastCoverage } from "./coverage-evaluator";
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
				artifactId: params.artifactId,
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
			title: `${response.path} の HTTP ${response.status ?? "error"}`,
			artifactId: params.rawArtifactId,
			location: { path: response.path, url: response.url },
			snippet: response.error ?? `status=${response.status}`,
			metadata: {
				status: response.status,
				finalUrl: response.finalUrl,
				contentType: response.contentType,
				bodyBytesRead: response.bodyBytesRead,
				bodyTruncated: response.bodyTruncated,
			},
		});

		if (response.status !== null && response.status >= 500) {
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: "unexpected-server-error",
					evidenceKey: String(response.status),
					title: "予期しないサーバーエラー応答",
					description:
						"範囲限定のread-only DAST実行中に5xx応答を観測しました。",
					severity: "low",
					snippet: `HTTP ${response.status} at ${response.path}`,
				}),
			);
		}

		if (isHtmlDocumentResponse(response)) {
			const missing = [
				"content-security-policy",
				"x-frame-options",
				"x-content-type-options",
				"referrer-policy",
			].filter((header) => response.headers[header] === undefined);
			if (missing.length > 0) {
				findings.push(
					createFinding({
						...findingBase(params, response.path, params.rawArtifactId),
						ruleId: "missing-applicable-security-header",
						evidenceKey: missing.join(","),
						title: "HTML文書のセキュリティヘッダーが不足",
						description: `HTML文書に適用可能なhardening headerが不足しています: ${missing.join(", ")}.`,
						severity: "info",
						snippet: `不足 header: ${missing.join(", ")}`,
						metadata: { missingHeaders: missing },
					}),
				);
			}
		}

		if (
			params.target.normalizedOrigin.startsWith("https://") &&
			response.status !== null &&
			response.status >= 200 &&
			response.status < 400 &&
			response.headers["strict-transport-security"] === undefined
		) {
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: "missing-hsts",
					evidenceKey: "strict-transport-security",
					title: "HTTPS応答にHSTSがありません",
					description:
						"HTTPS deployment contextでStrict-Transport-Securityが観測されませんでした。",
					severity: "info",
					snippet: "strict-transport-security: missing",
				}),
			);
		}

		for (const cookie of response.setCookies) {
			const sessionLike = /(?:session|sid|auth|token|jwt|login)/i.test(
				cookie.name,
			);
			const weak =
				(sessionLike && !cookie.httpOnly) ||
				(params.target.normalizedOrigin.startsWith("https://") &&
					!cookie.secure) ||
				!cookie.sameSite ||
				(cookie.name.startsWith("__Host-") &&
					(!cookie.secure ||
						!cookie.attributes.some(
							(attribute) => attribute.toLowerCase() === "path",
						))) ||
				(cookie.name.startsWith("__Secure-") && !cookie.secure);
			if (!weak) continue;
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: "weak-cookie-flags",
					evidenceKey: cookie.name,
					title: "Cookieの適用可能なセキュリティ属性が不足",
					description:
						"deployment contextとcookie用途に照らして推奨属性が不足しています。",
					severity: "low",
					snippet: `${cookie.name}: secure=${cookie.secure}, httpOnly=${cookie.httpOnly}, sameSite=${cookie.sameSite}`,
					metadata: { cookieName: cookie.name, sessionLike },
				}),
			);
		}

		const corsOrigin = response.headers["access-control-allow-origin"];
		const corsCredentials =
			response.headers["access-control-allow-credentials"]?.toLowerCase() ===
			"true";
		if (corsOrigin === "*") {
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: corsCredentials
						? "cors-wildcard-with-credentials"
						: "cors-wildcard-observation",
					evidenceKey: `*:${corsCredentials}`,
					title: corsCredentials
						? "credential付きwildcard CORSを観測"
						: "wildcard CORSを観測",
					description: corsCredentials
						? "資格情報を許可する応答でwildcard CORSを観測しました。"
						: "wildcard CORSを観測しました。機密応答かどうかは別途確認が必要です。",
					severity: corsCredentials ? "medium" : "info",
					snippet: `access-control-allow-origin: *; credentials=${corsCredentials}`,
				}),
			);
		}

		const commonPathSignal =
			(response.path === "/.env" && response.bodySignals.envFile) ||
			(response.path === "/debug" &&
				(response.bodySignals.debugDisclosure ||
					response.bodySignals.frameworkError));
		if (
			commonPathSignal &&
			response.status !== null &&
			response.status >= 200 &&
			response.status < 300
		) {
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: "sensitive-common-path-exposed",
					evidenceKey: `${response.path}:signature`,
					title: "機微な共通パスの内容を確認",
					description:
						"成功statusだけでなく、機微情報またはdebug disclosureのsignatureを観測しました。",
					severity: "medium",
					snippet: `${response.path} returned a matching redacted signature`,
				}),
			);
		}
		if (
			response.bodySignals.directoryListing &&
			response.status !== null &&
			response.status >= 200 &&
			response.status < 300
		) {
			findings.push(
				createFinding({
					...findingBase(params, response.path, params.rawArtifactId),
					ruleId: "directory-listing-exposed",
					evidenceKey: "index-of",
					title: "ディレクトリ一覧を観測",
					description: "HTML応答にディレクトリ一覧のsignatureを観測しました。",
					severity: "low",
					snippet: "directory listing signature matched",
				}),
			);
		}
	}

	const evaluated = evaluateDastCoverage({
		routeInventory: params.result.routeInventory,
		requestCount: params.result.requestCount,
		responseBytesRead: params.result.coverage.responseBytesRead,
		findingCount: findings.length,
		budgetExhausted: params.result.coverage.budgetExhausted,
		authRequired: params.profile.requiresAuth,
		authSucceeded:
			!params.profile.requiresAuth ||
			params.result.coverage.authFailureCount === 0,
		limitationCodes: params.result.coverage.limitationCodes,
	});
	return {
		findings,
		evidence,
		...evaluated,
		summary: dastSummary(
			"HTTP DAST",
			params.result.requestCount,
			findings.length,
			evaluated,
		),
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
				title: `${route.path} のbrowser console error`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: route.url },
				snippet: message,
				metadata: {},
			});
		}
		for (const request of route.failedRequests) {
			evidence.push({
				kind: "browser-network",
				title: `${route.path} の失敗したbrowser request`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: request.url },
				snippet: `${request.method} ${request.url}: ${request.failure}`,
				metadata: {},
			});
		}
		if (route.error) {
			evidence.push({
				kind: "dast-result",
				title: `${route.path} のbrowser route error`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: route.url },
				snippet: route.error,
				metadata: {},
			});
		}
	}
	const evaluated = evaluateDastCoverage({
		routeInventory: params.result.routeInventory,
		requestCount: params.result.coverage.requestCount,
		findingCount: 0,
		budgetExhausted: params.result.coverage.budgetExhausted,
		authRequired: params.profile.requiresAuth,
		authSucceeded:
			!params.profile.requiresAuth ||
			params.result.coverage.authFailureCount === 0,
		limitationCodes: params.result.coverage.limitationCodes,
	});
	return {
		findings,
		evidence,
		...evaluated,
		summary: dastSummary(
			"Browser DAST",
			params.result.coverage.requestCount,
			0,
			evaluated,
		),
	};
}

export function normalizeDastResult(params: {
	projectId: string;
	target: ValidatedDastTarget;
	profile: DastProfileDefinition;
	result: DastRawResult;
	rawArtifactId: string | null;
}): DastNormalizerResult {
	return params.result.kind === "http"
		? normalizeHttp({ ...params, result: params.result })
		: normalizeBrowser({ ...params, result: params.result });
}

function findingBase(
	params: {
		projectId: string;
		target: ValidatedDastTarget;
		profile: DastProfileDefinition;
	},
	path: string,
	artifactId: string | null,
) {
	return {
		projectId: params.projectId,
		target: params.target,
		profile: params.profile,
		sourceTool: "dast-http" as const,
		path,
		artifactId,
	};
}

function isHtmlDocumentResponse(
	response: DastHttpRawResult["responses"][number],
): boolean {
	return (
		response.status !== null &&
		response.status >= 200 &&
		response.status < 400 &&
		response.bodySignals.htmlDocument
	);
}

function dastSummary(
	label: string,
	requestCount: number,
	findingCount: number,
	evaluation: ReturnType<typeof evaluateDastCoverage>,
): string {
	return `${label}は${requestCount}件のrequestを実行し、${findingCount}件のfindingを観測しました。verdict=${evaluation.verdict}, coverage=${evaluation.coverageStatus}, known=${evaluation.coverageSummary.knownRouteCount}, attempted=${evaluation.coverageSummary.attemptedRouteCount}.`;
}
