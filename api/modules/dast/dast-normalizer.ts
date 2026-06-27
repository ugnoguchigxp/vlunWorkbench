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
			title: `${response.path} の HTTP ${response.status ?? "error"}`,
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
					title: "予期しないサーバーエラー応答",
					description:
						"設定済み DAST route が、範囲限定の HTTP baseline 実行中に 5xx 応答を返しました。",
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
					title: "一般的なセキュリティヘッダーが不足",
					description: `レスポンスに一般的な hardening header が不足しています: ${missing.join(", ")}.`,
					severity: "info",
					snippet: `不足 header: ${missing.join(", ")}`,
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
						title: "Cookie の推奨セキュリティ属性が不足",
						description:
							"推奨される Secure、HttpOnly、SameSite 属性の一部が不足した Set-Cookie header を検出しました。",
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
					title: "ワイルドカード CORS ポリシーを検出",
					description:
						"レスポンスが Access-Control-Allow-Origin を * に設定しています。endpoint によってはブラウザから読み取り可能な応答を公開する可能性があります。",
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
					title: "機微な共通パスに到達可能",
					description:
						"範囲限定の common-path probe が、機微になりやすい path で成功応答を返しました。",
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
		summary: `HTTP DAST baseline は ${params.result.requestCount} 件の request で完了し、${findings.length} 件の finding を検出しました。`,
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
				title: `${route.path} の browser console error`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: route.url },
				snippet: message,
				metadata: {},
			});
		}
		for (const request of route.failedRequests) {
			evidence.push({
				kind: "browser-network",
				title: `${route.path} の失敗した browser request`,
				artifactId: params.rawArtifactId,
				location: { path: route.path, url: request.url },
				snippet: `${request.method} ${request.url}: ${request.failure}`,
				metadata: {},
			});
		}
		if (route.error) {
			evidence.push({
				kind: "dast-result",
				title: `${route.path} の browser route error`,
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
		summary: `Browser smoke は ${params.result.routes.length} 件の設定済み route で完了しました。`,
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
