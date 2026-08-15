import { describe, expect, it, vi } from "vitest";
import { dependencyNoFindingsObservedFixture } from "../../../../shared/fixtures/security-intelligence-assessment-v1";
import {
	nightworkersSecurityIntelligenceErrorEnvelopeSchema,
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence.schema";
import {
	deriveProviderWorkspaceTargetGrant,
	deriveSecurityIntelligenceBindingProof,
	nightworkersSecurityIntelligenceBindingProofEnvelopeSchema,
	nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema,
	providerWorkspaceTargetPreviewEnvelopeSchema,
	providerWorkspaceTargetStartEnvelopeSchema,
} from "../../../../shared/schemas/nightworkers-security-intelligence-binding.schema";
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
const GRANT_REF = `siwg:v1:${"1".repeat(64)}`;
const PREVIEW_REF = `siwp:v1:${"2".repeat(64)}`;
const digest = (character: string): string =>
	`sha256:${character.repeat(64)}`;

describe("NightWorkers Security Intelligence routes", () => {
	it("creates a scoped workspace grant without returning the absolute path", async () => {
		const setup = createRoute({
			scopes: ["nightworkers:security-scan:write"],
		});
		const response = await setup.app.request(
			requestPath("/workspace-target-grants", {
				method: "POST",
				body: JSON.stringify({
					version: 1,
					providerProjectRef: PROJECT_ID,
					workspaceSubjectRef: "evidence-subject:1",
					workspacePath: "/workspace/task",
					expectedGitCommonDirDigest: digest("c"),
					expectedHeadSha: "b".repeat(40),
				}),
			}),
		);
		expect(response.status).toBe(201);
		const raw = await response.text();
		expect(raw).not.toContain("/workspace/task");
		expect(setup.workspaceGrantService.createGrant).toHaveBeenCalledWith(
			expect.objectContaining({ id: "client-1" }),
			expect.objectContaining({ workspacePath: "/workspace/task" }),
		);
	});

	it("previews and starts a workspace grant with validated envelopes", async () => {
		const setup = createRoute({
			scopes: [
				"nightworkers:security-scan:read",
				"nightworkers:security-scan:write",
			],
		});
		const preview = await setup.app.request(
			requestPath(`/workspace-target-grants/${GRANT_REF}/preview`, {
				method: "POST",
				body: JSON.stringify({
					version: 1,
					selection: { mode: "preset", presetId: "standard" },
				}),
			}),
		);
		expect(preview.status).toBe(200);
		expectPrivateNoStore(preview);
		providerWorkspaceTargetPreviewEnvelopeSchema.parse(await preview.json());

		const start = await setup.app.request(
			requestPath(`/workspace-target-grants/${GRANT_REF}/scans`, {
				method: "POST",
				headers: { "Idempotency-Key": "workspace-start-1" },
				body: JSON.stringify({
					version: 1,
					previewRef: PREVIEW_REF,
					selection: { mode: "preset", presetId: "standard" },
					expectedTargetDigest: "b".repeat(64),
				}),
			}),
		);
		expect(start.status).toBe(202);
		providerWorkspaceTargetStartEnvelopeSchema.parse(await start.json());
		expect(setup.workspaceGrantService.start).toHaveBeenCalledWith(
			expect.objectContaining({ id: "client-1" }),
			GRANT_REF,
			expect.any(Object),
			"workspace-start-1",
		);
		expect(setup.auditRepository.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "workspace_target_scan_start",
				outcome: "accepted",
				idempotencyKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
			}),
		);
		expect(JSON.stringify(setup.auditRepository.recordAudit.mock.calls)).not.toContain(
			"workspace-start-1",
		);
	});

	it("rejects malformed grant refs and missing idempotency before service access", async () => {
		const setup = createRoute({
			scopes: [
				"nightworkers:security-scan:read",
				"nightworkers:security-scan:write",
			],
		});
		const malformed = await setup.app.request(
			requestPath("/workspace-target-grants/not-a-grant/preview", {
				method: "POST",
				body: JSON.stringify({
					version: 1,
					selection: { mode: "preset", presetId: "standard" },
				}),
			}),
		);
		expect(malformed.status).toBe(400);

		const missingKey = await setup.app.request(
			requestPath(`/workspace-target-grants/${GRANT_REF}/scans`, {
				method: "POST",
				body: JSON.stringify({
					version: 1,
					previewRef: PREVIEW_REF,
					selection: { mode: "preset", presetId: "standard" },
					expectedTargetDigest: "b".repeat(64),
				}),
			}),
		);
		expect(missingKey.status).toBe(400);
		expect(setup.workspaceGrantService.preview).not.toHaveBeenCalled();
		expect(setup.workspaceGrantService.start).not.toHaveBeenCalled();
		expect(setup.auditRepository.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "workspace_target_scan_start",
				outcome: "rejected",
				errorCode: "invalid_request",
			}),
		);
	});

	it("enforces write scope and body size before creating a grant", async () => {
		const denied = createRoute({ scopes: ["nightworkers:security-scan:read"] });
		const deniedResponse = await denied.app.request(
			requestPath("/workspace-target-grants", {
				method: "POST",
				body: "{}",
			}),
		);
		expect(deniedResponse.status).toBe(403);
		expect(denied.workspaceGrantService.createGrant).not.toHaveBeenCalled();

		const limited = createRoute({
			scopes: ["nightworkers:security-scan:write"],
			maxRequestBytes: 8,
		});
		const limitedResponse = await limited.app.request(
			requestPath("/workspace-target-grants", {
				method: "POST",
				body: JSON.stringify({ value: "too large" }),
			}),
		);
		expect(limitedResponse.status).toBe(413);
		expect((await limitedResponse.json()).error.code).toBe("invalid_request");
		expect(limited.workspaceGrantService.createGrant).not.toHaveBeenCalled();
	});

	it("returns capabilities without advertising full or local CLI support", async () => {
		const setup = createRoute();
		const response = await setup.app.request(
			requestPath("/capabilities"),
		);
		expect(response.status).toBe(200);
		expectPrivateNoStore(response);
		const body =
			nightworkersSecurityIntelligenceCapabilitiesEnvelopeSchema.parse(
				await response.json(),
			);
		expect(body.data.supportedTargetKinds).toEqual(["working_tree"]);
		expect(body.data.unsupportedTargetKinds).toEqual(["full"]);
		expect(body.data.unsupportedTransports).toEqual(["local_cli"]);
	});

	it("returns an authenticated binding proof for the persisted scan", async () => {
		const setup = createRoute();
		const response = await setup.app.request(
			requestPath(`/scans/${SCAN_ID}/binding-proof`),
		);
		expect(response.status).toBe(200);
		expectPrivateNoStore(response);
		const body =
			nightworkersSecurityIntelligenceBindingProofEnvelopeSchema.parse(
				await response.json(),
			);
		expect(body.data.rawScanRunRef).toBe(SCAN_ID);
		expect(setup.service.bindingProof).toHaveBeenCalledWith(
			expect.objectContaining({ id: "client-1" }),
			SCAN_ID,
		);
	});

	it("returns the versioned read-only assessment envelope", async () => {
		const setup = createRoute();
		const response = await setup.app.request(request(SCAN_ID));

		expect(response.status).toBe(200);
		expectPrivateNoStore(response);
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
		expectPrivateNoStore(unauthorizedResponse);
		expect((await unauthorizedResponse.json()).error.code).toBe(
			"integration_unauthorized",
		);

		const denied = createRoute({ scopes: [] });
		const deniedResponse = await denied.app.request(request(SCAN_ID));
		expect(deniedResponse.status).toBe(403);
		expectPrivateNoStore(deniedResponse);
		expect((await deniedResponse.json()).error.code).toBe(
			"integration_scope_denied",
		);
		expect(denied.service.assessment).not.toHaveBeenCalled();
	});

	it("rejects a malformed scan reference before service access", async () => {
		const setup = createRoute();
		const response = await setup.app.request(request("not-a-uuid"));
		expect(response.status).toBe(400);
		expectPrivateNoStore(response);
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
	maxRequestBytes?: number;
}) {
	const auditRepository = { recordAudit: vi.fn(async () => undefined) };
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
		capabilities: vi.fn(() => ({
			contractVersion: 1 as const,
			identityMappingVersion: 1 as const,
			available: true as const,
			supportedTransports: ["http_service"] as ["http_service"],
			supportedTargetKinds: ["working_tree"] as ["working_tree"],
			unsupportedTransports: ["local_cli"] as ["local_cli"],
			unsupportedTargetKinds: ["full"] as ["full"],
			maxResponseBytes: 2 * 1024 * 1024,
			workspaceTargetGrant: {
				available: false,
				reasonCode: "workspace_target_grant_unavailable" as const,
				maxRequestBytes: 16 * 1024,
				ttlSeconds: 300,
			},
		})),
		bindingProof: vi.fn(async () =>
			deriveSecurityIntelligenceBindingProof({
				version: 1,
				identityMappingVersion: 1,
				rawProviderProjectRef: PROJECT_ID,
				canonicalProjectRef: `project:${PROJECT_ID}`,
				rawScanRunRef: SCAN_ID,
				canonicalScanRunRef: `scan-run:${SCAN_ID}`,
				target: {
					kind: "diff",
					baseRevision: "a".repeat(40),
					assessedRevision: "b".repeat(40),
					rawTargetDigest: "b".repeat(64),
					canonicalTargetDigest: digest("b"),
				},
			}),
		),
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
	const workspaceGrantService = {
		createGrant: vi.fn(async () =>
			deriveProviderWorkspaceTargetGrant({
				version: 1,
				providerProjectRef: PROJECT_ID,
				workspaceSubjectRef: "evidence-subject:1",
				expectedGitCommonDirDigest: digest("c"),
				expectedHeadSha: "b".repeat(40),
				providerWorkspaceStateDigest: digest("d"),
				expiresAt: "2026-08-15T02:00:00.000Z",
			}),
		),
		preview: vi.fn(async () => ({
			version: 1 as const,
			grantRef: GRANT_REF,
			previewRef: PREVIEW_REF,
			resolvedProfileRef: "diff-basic-security",
			target: {
				kind: "working_tree" as const,
				digest: "b".repeat(64),
				canonicalDigest: digest("b"),
				baseRevision: "a".repeat(40),
				assessedRevision: `working-tree/${"b".repeat(64)}`,
				providerWorkspaceStateDigest: digest("d"),
				fileCount: 1,
			},
			expiresAt: "2026-08-15T01:04:00.000Z",
		})),
		start: vi.fn(async () => ({
			version: 1 as const,
			grantRef: GRANT_REF,
			scanRunRef: SCAN_ID,
			status: "queued" as const,
			resolvedProfileRef: "diff-basic-security",
			target: {
				kind: "working_tree" as const,
				digest: "b".repeat(64),
				sourceRevision: "a".repeat(40),
				providerWorkspaceStateDigest: digest("d"),
			},
			createdAt: "2026-08-15T01:00:00.000Z",
			replayed: false,
		})),
	};
	return {
		app: createNightworkersSecurityIntelligenceRoutes({
			integrationClientService: integrationClientService as never,
			auditRepository,
			service,
			workspaceGrantService,
			maxRequestBytes: options?.maxRequestBytes,
		}),
		service,
		workspaceGrantService,
		auditRepository,
	};
}

function request(scanRunRef: string) {
	return requestPath(`/scans/${scanRunRef}/assessment`);
}

function requestPath(path: string, init: RequestInit = {}) {
	return new Request(`http://localhost${path}`, {
		...init,
		headers: {
			Authorization:
				"Bearer vwi_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHijk",
			"X-Request-Id": "request-1",
			"Content-Type": "application/json",
			...init.headers,
		},
	});
}

function dependencyAssessment(): SecurityIntelligenceAssessmentV1 {
	const assessment = structuredClone(dependencyNoFindingsObservedFixture);
	const target = {
		kind: "diff" as const,
		sourceRevision: "b".repeat(40),
		targetDigest: digest("b"),
	};
	assessment.projectRef = `project:${PROJECT_ID}`;
	assessment.source.scanRunRef = `scan-run:${SCAN_ID}`;
	assessment.target = target;
	assessment.evidenceRefs = assessment.evidenceRefs.map((evidence) => ({
		...evidence,
		scanRunRef: assessment.source.scanRunRef,
		targetDigest: target.targetDigest,
	}));
	assessment.assessmentRef = deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}

function expectPrivateNoStore(response: Response): void {
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	expect(response.headers.get("Pragma")).toBe("no-cache");
	expect(
		response.headers
			.get("Vary")
			?.split(",")
			.map((field) => field.trim().toLowerCase()),
	).toContain("authorization");
}
