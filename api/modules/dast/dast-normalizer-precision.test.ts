import { describe, expect, it } from "vitest";
import { EMPTY_DAST_COVERAGE_SUMMARY } from "../../../shared/schemas/dast-coverage.schema";
import { normalizeDastResult } from "./dast-normalizer";
import { getDastProfile } from "./profiles";
import type {
	DastHttpRawResult,
	DastHttpResponseObservation,
	DastRouteInventoryEntry,
	ValidatedDastTarget,
} from "./types";

const allHtmlHeaders = {
	"content-security-policy": "default-src 'self'",
	"x-frame-options": "DENY",
	"x-content-type-options": "nosniff",
	"referrer-policy": "same-origin",
};

function target(): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "target-1",
		normalizedOrigin: "http://127.0.0.1:3000",
		runnerOrigin: "http://127.0.0.1:3000",
		allowedPaths: ["/"],
		excludedPaths: [],
		defaultHeaders: {},
		maxDepth: 2,
		maxRequests: 100,
		rateLimitPerSec: 2,
		timeoutSec: 5,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
}

function response(
	path: string,
	overrides: Partial<DastHttpResponseObservation> = {},
): DastHttpResponseObservation {
	return {
		path,
		url: `http://127.0.0.1:3000${path}`,
		finalUrl: `http://127.0.0.1:3000${path}`,
		status: 200,
		ok: true,
		redirectChain: [],
		headers: {},
		contentType: "text/plain",
		bodyBytesRead: 2,
		bodyTruncated: false,
		bodySignals: {
			htmlDocument: false,
			envFile: false,
			debugDisclosure: false,
			openApiDocument: false,
			directoryListing: false,
			frameworkError: false,
			spaFallback: false,
		},
		setCookies: [],
		durationMs: 1,
		error: null,
		...overrides,
	};
}

function raw(
	observation: DastHttpResponseObservation,
): DastHttpRawResult {
	const entry: DastRouteInventoryEntry = {
		method: "GET",
		path: observation.path,
		queryKeys: [],
		queryShapeHash: "empty",
		sources: ["configured"],
		depth: 0,
		required: true,
		authMode: "anonymous",
		state: "succeeded",
		statusCode: observation.status,
		limitationCode: null,
	};
	return {
		kind: "http",
		profileId: "web-passive-standard",
		targetOrigin: target().normalizedOrigin,
		startedAt: new Date(0).toISOString(),
		completedAt: new Date(1).toISOString(),
		requestCount: 1,
		responses: [observation],
		routeInventory: [entry],
		coverage: {
			...EMPTY_DAST_COVERAGE_SUMMARY,
			knownRouteCount: 1,
			actionableKnownRouteCount: 1,
			plannedRouteCount: 1,
			attemptedRouteCount: 1,
			successfulRouteCount: 1,
			requiredSeedCoverage: 1,
			actionableRouteCoverage: 1,
			requestCount: 1,
			responseBytesRead: observation.bodyBytesRead,
		},
		warnings: [],
	};
}

function normalize(
	observation: DastHttpResponseObservation,
	rawArtifactId: string | null = null,
) {
	const profile = getDastProfile("web-passive-standard");
	if (!profile) throw new Error("missing standard DAST profile");
	return normalizeDastResult({
		projectId: "project-1",
		target: target(),
		profile,
		result: raw(observation),
		rawArtifactId,
	});
}

describe("DAST passive check precision", () => {
	it("does not report an SPA fallback as an exposed .env file", () => {
		const result = normalize(
			response("/.env", {
				contentType: "text/html",
				headers: allHtmlHeaders,
				bodySignals: {
					...response("/.env").bodySignals,
					htmlDocument: true,
					spaFallback: true,
				},
			}),
		);

		expect(
			result.findings.some(
				(finding) => finding.ruleId === "sensitive-common-path-exposed",
			),
		).toBe(false);
	});

	it("reports a signature-backed exposed .env response", () => {
		const result = normalize(
			response("/.env", {
				bodySignals: {
					...response("/.env").bodySignals,
					envFile: true,
				},
			}),
			"raw-artifact-id",
		);

		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					ruleId: "sensitive-common-path-exposed",
				}),
			]),
		);
		expect(result.findings[0]?.evidence[0]?.artifactId).toBe(
			"raw-artifact-id",
		);
	});

	it("does not apply HTML header checks to a JSON 404", () => {
		const result = normalize(
			response("/missing", {
				status: 404,
				ok: false,
				contentType: "application/json",
			}),
		);

		expect(
			result.findings.some(
				(finding) =>
					finding.ruleId === "missing-applicable-security-header",
			),
		).toBe(false);
	});

	it("does not report a directory listing signature from an unsuccessful response", () => {
		const result = normalize(
			response("/files", {
				status: 404,
				ok: false,
				contentType: "text/html",
				headers: allHtmlHeaders,
				bodySignals: {
					...response("/files").bodySignals,
					htmlDocument: true,
					directoryListing: true,
				},
			}),
		);

		expect(
			result.findings.some(
				(finding) => finding.ruleId === "directory-listing-exposed",
			),
		).toBe(false);
	});

	it("does not require Secure or HSTS on a local HTTP response", () => {
		const result = normalize(
			response("/", {
				setCookies: [
					{
						name: "preferences",
						attributes: ["SameSite"],
						secure: false,
						httpOnly: false,
						sameSite: true,
					},
				],
			}),
		);

		expect(
			result.findings.some((finding) =>
				["weak-cookie-flags", "missing-hsts"].includes(finding.ruleId),
			),
		).toBe(false);
	});

	it("separates wildcard CORS observation from a fixed explicit origin", () => {
		const vulnerable = normalize(
			response("/api/data", {
				headers: { "access-control-allow-origin": "*" },
				contentType: "application/json",
			}),
		);
		const fixed = normalize(
			response("/api/data", {
				headers: {
					"access-control-allow-origin": "https://app.example.test",
				},
				contentType: "application/json",
			}),
		);

		expect(
			vulnerable.findings.some(
				(finding) => finding.ruleId === "cors-wildcard-observation",
			),
		).toBe(true);
		expect(
			fixed.findings.some((finding) =>
				finding.ruleId.startsWith("cors-wildcard"),
			),
		).toBe(false);
	});
});
