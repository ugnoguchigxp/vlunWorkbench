import { describe, expect, it, vi } from "vitest";
import { dependencyNoFindingsObservedFixture } from "../../../../shared/fixtures/security-intelligence-assessment-v1";
import {
	nightworkersSecurityIntelligenceErrorEnvelopeSchema,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import type { SecurityIntelligenceAssessmentV1 } from "../../../../shared/schemas/security-intelligence-assessment.schema";
import {
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
} from "../../../../shared/security-intelligence-assessment-contract";
import { IntegrationClientAuthenticationError } from "../../integrationClients/integration-client.service";
import { NightworkersIntegrationError } from "./nightworkers-integration.errors";
import {
	assessmentNotReady,
	assessmentUnavailable,
} from "./nightworkers-security-intelligence.errors";
import { projectNightworkersSecurityIntelligenceBundle } from "./nightworkers-security-intelligence-projection";
import { createNightworkersSecurityIntelligenceRoutes } from "./nightworkers-security-intelligence.routes";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SCAN_ID = "22222222-2222-4222-8222-222222222222";
const digest = (character: string): string =>
	`sha256:${character.repeat(64)}`;

describe("NightWorkers Security Intelligence routes", () => {
	it("returns the versioned read-only assessment envelope", async () => {
		const setup = createRoute();
		const response = await setup.app.request(request(SCAN_ID));

		expect(response.status).toBe(200);
		const body = nightworkersSecurityIntelligenceSuccessEnvelopeSchema.parse(
			await response.json(),
		);
		expect(body.requestId).toBe("request-1");
		expect(body.data.scanRunRef).toBe(`scan-run:${SCAN_ID}`);
		expect(setup.service.assessment).toHaveBeenCalledWith(
			expect.objectContaining({ id: "client-1" }),
			SCAN_ID,
		);
	});

	it("reuses bearer authentication and the scan read scope", async () => {
		const unauthorized = createRoute({ authenticationFails: true });
		const unauthorizedResponse = await unauthorized.app.request(request(SCAN_ID));
		expect(unauthorizedResponse.status).toBe(401);
		expect((await unauthorizedResponse.json()).error.code).toBe(
			"integration_unauthorized",
		);

		const denied = createRoute({ scopes: [] });
		const deniedResponse = await denied.app.request(request(SCAN_ID));
		expect(deniedResponse.status).toBe(403);
		expect((await deniedResponse.json()).error.code).toBe(
			"integration_scope_denied",
		);
		expect(denied.service.assessment).not.toHaveBeenCalled();
	});

	it("rejects a malformed scan reference before service access", async () => {
		const setup = createRoute();
		const response = await setup.app.request(request("not-a-uuid"));
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("invalid_request");
		expect(setup.service.assessment).not.toHaveBeenCalled();
	});

	it("keeps rate-limit details compatible with the new error envelope", async () => {
		const setup = createRoute({ rateLimit: 1 });
		expect((await setup.app.request(request(SCAN_ID))).status).toBe(200);
		const response = await setup.app.request(request(SCAN_ID));
		expect(response.status).toBe(429);
		const body = nightworkersSecurityIntelligenceErrorEnvelopeSchema.parse(
			await response.json(),
		);
		expect(body.error).toMatchObject({
			code: "rate_limit_exceeded",
			retryable: true,
			details: { retryAfterSeconds: expect.any(Number) },
		});
	});

	it("distinguishes retryable not-ready from terminal unavailable", async () => {
		for (const [error, status, expectedError] of [
			[assessmentNotReady(), 409, { code: "assessment_not_ready", retryable: true }],
			[assessmentUnavailable(), 422, { code: "assessment_unavailable", retryable: false }],
		] as const) {
			const setup = createRoute({ error });
			const response = await setup.app.request(request(SCAN_ID));
			expect(response.status).toBe(status);
			expect((await response.json()).error).toMatchObject(expectedError);
		}
	});

	it("does not expose unexpected backend messages or local paths", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const setup = createRoute({
			error: new Error("database failed at /Users/private/project.sqlite"),
		});
		const response = await setup.app.request(request(SCAN_ID));
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.error).toEqual({
			code: "internal_error",
			message: "Security Intelligence integration request failed.",
			retryable: false,
		});
		expect(JSON.stringify(body)).not.toContain("/Users/");
		expect(log).toHaveBeenCalledWith(
			expect.not.stringContaining("/Users/private"),
		);
		log.mockRestore();
	});

	it("redacts an unsafe message even from a known integration error", async () => {
		const setup = createRoute({
			error: new NightworkersIntegrationError(
				"scan_not_found",
				"Scan lookup failed at /Users/private/project.sqlite",
			),
		});
		const response = await setup.app.request(request(SCAN_ID));
		const body = await response.json();
		expect(response.status).toBe(404);
		expect(body.error).toEqual({
			code: "scan_not_found",
			message: "Security Intelligence integration request failed.",
			retryable: false,
		});
	});
});

function createRoute(options?: {
	scopes?: string[];
	authenticationFails?: boolean;
	error?: Error;
	rateLimit?: number;
}) {
	const integrationClientService = {
		authenticate: vi.fn(async () => {
			if (options?.authenticationFails) {
				throw new IntegrationClientAuthenticationError("invalid", "invalid");
			}
			return {
				id: "client-1",
				ownerUserId: "owner-1",
				tokenHash: "token-hash",
				scopes:
					options?.scopes ?? ["nightworkers:security-scan:read"],
				allowedRoots: [],
				rateLimitPolicy: {
					limit: options?.rateLimit ?? 100,
					windowMs: 60_000,
				},
			};
		}),
		markUsed: vi.fn(async () => undefined),
	};
	const service = {
		assessment: vi.fn(async () => {
			if (options?.error) throw options.error;
			return projectNightworkersSecurityIntelligenceBundle({
				dependencyAssessment: dependencyAssessment(),
				authorizationShadow: {
					status: "disabled",
					reasonCode: "authorization_shadow_disabled",
				},
			});
		}),
	};
	return {
		app: createNightworkersSecurityIntelligenceRoutes({
			integrationClientService: integrationClientService as never,
			service,
		}),
		service,
	};
}

function request(scanRunRef: string) {
	return new Request(
		`http://localhost/scans/${scanRunRef}/assessment`,
		{
			headers: {
				Authorization:
					"Bearer vwi_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHijk",
				"X-Request-Id": "request-1",
			},
		},
	);
}

function dependencyAssessment(): SecurityIntelligenceAssessmentV1 {
	const assessment = structuredClone(dependencyNoFindingsObservedFixture);
	const target = {
		kind: "diff" as const,
		sourceRevision: "b".repeat(40),
		targetDigest: digest("b"),
		baseRevision: "a".repeat(40),
		headRevision: "b".repeat(40),
		baseTargetDigest: digest("a"),
	};
	assessment.projectRef = `project:${PROJECT_ID}`;
	assessment.source.scanRunRef = `scan-run:${SCAN_ID}`;
	assessment.target = target;
	assessment.evidenceRefs = assessment.evidenceRefs.map((evidence) => ({
		...evidence,
		scanRunRef: assessment.source.scanRunRef,
		targetDigest:
			evidence.targetRole === "base_target"
				? target.baseTargetDigest
				: target.targetDigest,
	}));
	assessment.assessmentRef = deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}
