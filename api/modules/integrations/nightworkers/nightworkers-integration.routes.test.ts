import { describe, expect, it, vi } from "vitest";
import { IntegrationClientAuthenticationError } from "../../integrationClients/integration-client.service";
import { createNightworkersIntegrationRoutes } from "./nightworkers-integration.routes";

const SCAN_ID = "11111111-1111-4111-8111-111111111111";
const REPORT_ID = "22222222-2222-4222-8222-222222222222";
const IDEMPOTENCY_KEY = "33333333-3333-4333-8333-333333333333";

function client(
	scopes: string[],
	rateLimitPolicy = { limit: 100, windowMs: 60_000 },
) {
	return {
		id: "client-1",
		ownerUserId: "user-1",
		tokenHash: "token-hash",
		scopes,
		allowedRoots: ["/workspace"],
		rateLimitPolicy,
	};
}

function createRoute(options?: {
	scopes?: string[];
	authenticationFails?: boolean;
	authenticationBackendFails?: boolean;
	rateLimitPolicy?: { limit: number; windowMs: number };
}) {
	const integrationClientService = {
		authenticate: vi.fn(async () => {
			if (options?.authenticationBackendFails) {
				throw new Error("credential database unavailable");
			}
			if (options?.authenticationFails) {
				throw new IntegrationClientAuthenticationError("invalid", "invalid");
			}
			return client(
				options?.scopes ?? [
					"nightworkers:security-scan:read",
					"nightworkers:security-scan:write",
					"nightworkers:security-report:read",
					"nightworkers:security-report:write",
				],
				options?.rateLimitPolicy,
			);
		}),
		markUsed: vi.fn(async () => undefined),
	};
	const service = {
		capabilities: vi.fn(async () => ({
			provider: { id: "vulnworkbench", version: "1.0.0" },
		})),
		preview: vi.fn(),
		startScan: vi.fn(async () => ({
			scanRunRef: SCAN_ID,
			status: "queued",
			resolvedProfileRef: "diff-basic-security",
			target: {
				kind: "working_tree",
				digest: "a".repeat(64),
				sourceRevision: "b".repeat(40),
			},
			createdAt: "2026-07-30T00:00:00.000Z",
			replayed: false,
		})),
		scanDetail: vi.fn(),
		events: vi.fn(),
		cancel: vi.fn(),
		findings: vi.fn(),
		listReports: vi.fn(async () => ({ items: [] })),
		startReport: vi.fn(async () => ({
			report: {
				reportRef: REPORT_ID,
				scanRunRef: SCAN_ID,
				status: "queued",
			},
			replayed: false,
		})),
		reportDetail: vi.fn(async () => ({
			reportRef: REPORT_ID,
			scanRunRef: SCAN_ID,
			status: "completed",
		})),
		reportContent: vi.fn(async () => ({
			content: "# Security report",
			title: "Project security report",
		})),
	};
	const auditRepository = {
		recordAudit: vi.fn(async () => undefined),
	};
	const app = createNightworkersIntegrationRoutes({
		integrationClientService: integrationClientService as never,
		auditRepository,
		service: service as never,
		maxRequestBytes: 64 * 1024,
	});
	return { app, auditRepository, integrationClientService, service };
}

function request(path: string, init?: RequestInit) {
	return new Request(`http://localhost${path}`, {
		...init,
		headers: {
			Authorization: "Bearer vwi_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHijk",
			"Content-Type": "application/json",
			"X-Request-Id": "request-1",
			...init?.headers,
		},
	});
}

describe("NightWorkers integration routes", () => {
	it("returns the versioned error envelope when authentication fails", async () => {
		const { app } = createRoute({ authenticationFails: true });
		const response = await app.request(
			request("/capabilities", {
				method: "POST",
				body: JSON.stringify({ projectPath: "/workspace/project" }),
			}),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			contractVersion: 1,
			requestId: "request-1",
			error: {
				code: "integration_unauthorized",
				message: "Valid integration bearer authentication is required.",
				retryable: false,
			},
		});
	});

	it("does not disguise an authentication backend failure as invalid credentials", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { app } = createRoute({ authenticationBackendFails: true });
		const response = await app.request(
			request("/capabilities", {
				method: "POST",
				body: JSON.stringify({ projectPath: "/workspace/project" }),
			}),
		);

		expect(response.status).toBe(500);
		expect((await response.json()).error).toMatchObject({
			code: "internal_error",
			retryable: false,
		});
		log.mockRestore();
	});

	it("rejects a route when the credential lacks its scope", async () => {
		const { app } = createRoute({
			scopes: ["nightworkers:security-scan:read"],
		});
		const response = await app.request(
			request(`/scans/${SCAN_ID}/reports`),
		);

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe(
			"integration_scope_denied",
		);
	});

	it("does not update last-used for a request rejected by the rate limiter", async () => {
		const { app, integrationClientService } = createRoute({
			rateLimitPolicy: { limit: 1, windowMs: 60_000 },
		});
		const first = await app.request(
			request("/capabilities", {
				method: "POST",
				body: JSON.stringify({ projectPath: "/workspace/project" }),
			}),
		);
		const second = await app.request(
			request("/capabilities", {
				method: "POST",
				body: JSON.stringify({ projectPath: "/workspace/project" }),
			}),
		);

		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
		expect(integrationClientService.markUsed).toHaveBeenCalledTimes(1);
	});

	it("requires a UUID Idempotency-Key before starting a scan", async () => {
		const { app, auditRepository, service } = createRoute();
		const response = await app.request(
			request("/scans", {
				method: "POST",
				body: JSON.stringify({
					projectPath: "/workspace/project",
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "working_tree" },
					previewRef: "preview-1",
					expectedTargetDigest: "a".repeat(64),
				}),
			}),
		);

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("invalid_request");
		expect(service.startScan).not.toHaveBeenCalled();
		expect(auditRepository.recordAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				operation: "scan_start",
				outcome: "rejected",
				errorCode: "invalid_request",
			}),
		);
	});

	it("starts a report asynchronously and forwards the request ID", async () => {
		const { app, service } = createRoute();
		const response = await app.request(
			request(`/scans/${SCAN_ID}/reports`, {
				method: "POST",
				headers: { "Idempotency-Key": IDEMPOTENCY_KEY },
				body: JSON.stringify({
					summaryMode: "deterministic_with_llm_summary",
				}),
			}),
		);

		expect(response.status).toBe(202);
		expect((await response.json()).data.report.reportRef).toBe(REPORT_ID);
		expect(service.startReport).toHaveBeenCalledWith({
			client: expect.objectContaining({ id: "client-1" }),
			scanRunId: SCAN_ID,
			idempotencyKey: IDEMPOTENCY_KEY,
			requestId: "request-1",
		});
	});

	it("returns completed Markdown with safe download headers", async () => {
		const { app } = createRoute();
		const response = await app.request(
			request(`/scans/${SCAN_ID}/reports/${REPORT_ID}/content`),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/markdown");
		expect(response.headers.get("Content-Disposition")).toBe(
			'attachment; filename="project-security-report-22222222.md"',
		);
		expect(await response.text()).toBe("# Security report");
	});
});
