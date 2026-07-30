import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createScansRoute } from "./scans.route";
import { HttpError } from "../modules/auth/errors";

describe("Scans Route", () => {
	const mockProjectRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return { id: "p-1", name: "Project 1", ownerUserId: "user-123" };
			}
			return null;
		}),
	};

	const mockScanRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "s-1") {
				return { id: "s-1", projectId: "p-1", status: "completed" };
			}
			return null;
		}),
		listScanRunsByProject: vi.fn().mockResolvedValue([{ id: "s-1", status: "completed" }]),
		listScanEvents: vi.fn().mockResolvedValue([{ id: "e-1", eventType: "scan.started" }]),
	};

	const mockArtifactRepo = {
		listArtifacts: vi.fn().mockResolvedValue([{ id: "a-1", kind: "raw_result" }]),
	};

	const mockFindingRepo = {
		listFindings: vi.fn().mockResolvedValue([{ id: "f-1", ruleId: "rule-1" }]),
	};

	const mockDecisionRepo = {
		findLatestDecisionForFinding: vi
			.fn()
			.mockResolvedValue({ id: "d-1", decision: "needs_fix" }),
	};
	const mockFindingReviewRepo = {
		findLatestReview: vi
			.fn()
			.mockResolvedValue({ id: "r-1", status: "completed" }),
	};
	const mockScanReportRepo = {
		listReportsForScan: vi.fn().mockResolvedValue([]),
		findById: vi.fn().mockResolvedValue({
			id: "report-1",
			scanRunId: "s-1",
			format: "markdown",
			title: "Filtered Report",
			status: "queued",
			artifactId: null,
		}),
		createReport: vi.fn().mockResolvedValue({
			id: "report-1",
			scanRunId: "s-1",
			format: "markdown",
			title: "Filtered Report",
			status: "running",
			artifactId: null,
		}),
		updateReportStatus: vi.fn().mockResolvedValue({
			id: "report-1",
			status: "failed",
			artifactId: null,
		}),
	};
	const mockScanReviewRepo = {
		listReviews: vi.fn().mockResolvedValue([]),
		findById: vi.fn().mockResolvedValue({
			id: "scan-review-1",
			scanRunId: "s-1",
			status: "running",
		}),
	};
	const mockScanReviewRunner = {
		start: vi.fn().mockResolvedValue({
			reviewId: "scan-review-1",
			status: "running",
			completion: new Promise(() => {}),
		}),
	};
	const mockScanDiagnosticRepo = {
		listForScan: vi.fn().mockResolvedValue([
			{
				id: "diagnostic-1",
				scanRunId: "s-1",
				status: "completed",
				readiness: "ready",
			},
		]),
		findById: vi.fn().mockResolvedValue({
			id: "diagnostic-1",
			scanRunId: "s-1",
			status: "queued",
			readiness: null,
		}),
	};
	const mockScanDiagnosticRunner = {
		retry: vi.fn().mockResolvedValue({
			diagnosticRunId: "diagnostic-1",
			status: "queued",
			completion: new Promise(() => {}),
		}),
	};
	const mockAssessmentRepository = {
		listCoverageResults: vi.fn().mockResolvedValue([]),
	};
	const mockScanReportRunner = {
		start: vi.fn().mockResolvedValue({
			reportId: "report-1",
			status: "queued",
			completion: new Promise(() => {}),
		}),
	};
	const mockScanSupervisor = {
		cancel: vi.fn().mockResolvedValue({ cancelled: true }),
	};

	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", { userId: "user-123", email: "user@example.com", role: "member" });
		await next();
	});
	app.onError((err, c) => {
		if (err instanceof HttpError) {
			return c.json({ message: err.message }, err.status as any);
		}
		return c.json({ message: err.message }, 500);
	});
	app.route(
		"/",
		createScansRoute({
			scanRepository: mockScanRepo as any,
			projectRepository: mockProjectRepo as any,
			artifactRepository: mockArtifactRepo as any,
			findingRepository: mockFindingRepo as any,
			decisionRepository: mockDecisionRepo as any,
			findingReviewRepository: mockFindingReviewRepo as any,
			scanReportRepository: mockScanReportRepo as any,
			scanReviewRepository: mockScanReviewRepo as any,
			scanDiagnosticRepository: mockScanDiagnosticRepo as any,
			assessmentRepository: mockAssessmentRepository as any,
			scanReviewRunner: mockScanReviewRunner as any,
			scanReportRunner: mockScanReportRunner as any,
			scanDiagnosticRunner: mockScanDiagnosticRunner as any,
			artifactStorage: {} as any,
			db: {} as any,
			scanSupervisor: mockScanSupervisor as any,
		}),
	);

	it("GET /?projectId=p-1 returns scans list", async () => {
		const res = await app.request("/?projectId=p-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.scans.length).toBe(1);
	});

	it("GET /:scanRunId returns scan details", async () => {
		const res = await app.request("/s-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.scan.id).toBe("s-1");
	});

	it("GET /:scanRunId/events returns events list", async () => {
		const res = await app.request("/s-1/events");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.events.length).toBe(1);
	});

	it("POST /:scanRunId/cancel delegates only after ownership succeeds", async () => {
		const res = await app.request("/s-1/cancel", { method: "POST" });
		expect(res.status).toBe(200);
		expect(mockScanSupervisor.cancel).toHaveBeenCalledWith("s-1");
	});

	it("GET /:scanRunId/artifacts returns artifacts list", async () => {
		const res = await app.request("/s-1/artifacts");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.artifacts.length).toBe(1);
	});

	it("GET /:scanRunId/findings returns findings list", async () => {
		const res = await app.request("/s-1/findings");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.findings.length).toBe(1);
		expect(body.findings[0].latestDecision).toMatchObject({ id: "d-1" });
		expect(body.findings[0].latestReview).toMatchObject({ id: "r-1" });
		expect(mockDecisionRepo.findLatestDecisionForFinding).toHaveBeenCalledWith(
			"f-1",
		);
		expect(mockFindingReviewRepo.findLatestReview).toHaveBeenCalledWith("f-1");
	});

	it("GET /:scanRunId/summary returns scan summary", async () => {
		// Mock the module function
		const summaryModule = await import("../modules/scans/summary-builder");
		vi.spyOn(summaryModule, "buildScanRunSummary").mockResolvedValue({
			scanRunId: "s-1",
			profileId: "baseline",
			profileOutcome: "completed",
			tools: [],
			totals: { findingCount: 0, artifactCount: 0, reviewedFindingCount: 0, decidedFindingCount: 0 }
		});

		const res = await app.request("/s-1/summary");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.summary.scanRunId).toBe("s-1");
	});

	it("GET /:scanRunId/groups returns grouped findings", async () => {
		// Mock the module function
		const groupingModule = await import("../modules/scans/grouping-builder");
		vi.spyOn(groupingModule, "buildGroupedFindings").mockResolvedValue({
			groups: []
		});

		const res = await app.request("/s-1/groups");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.groups).toHaveLength(0);
	});

	it("POST /:scanRunId/reviews returns 202 without waiting for LLM completion", async () => {
		mockScanReviewRunner.start.mockClear();
		const res = await app.request("/s-1/reviews", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ findingFilter: "all" }),
		});

		expect(res.status).toBe(202);
		expect(mockScanReviewRunner.start).toHaveBeenCalledWith(
			"s-1",
			expect.objectContaining({
				task: "scan_review",
				createdByUserId: "user-123",
				findingFilter: "all",
			}),
		);
		expect(await res.json()).toMatchObject({
			review: { id: "scan-review-1", status: "running" },
			result: {
				ok: true,
				reviewId: "scan-review-1",
				status: "running",
			},
		});
	});

	it("GET /:scanRunId/diagnostics returns automated pipeline state", async () => {
		const res = await app.request("/s-1/diagnostics");

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			diagnostics: [{ id: "diagnostic-1", readiness: "ready" }],
		});
	});

	it("POST /:scanRunId/diagnostics/retry schedules the failed stage", async () => {
		mockScanDiagnosticRunner.retry.mockClear();
		const res = await app.request("/s-1/diagnostics/retry", {
			method: "POST",
		});

		expect(res.status).toBe(202);
		expect(mockScanDiagnosticRunner.retry).toHaveBeenCalledWith("s-1");
		expect(await res.json()).toMatchObject({
			diagnostic: { id: "diagnostic-1", status: "queued" },
		});
	});

	it("POST /:scanRunId/reports normalizes report generation to the full set", async () => {
		mockScanReportRunner.start.mockClear();

		const res = await app.request("/s-1/reports", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				format: "markdown",
				title: "Filtered Report",
				includeFalsePositives: false,
				includeDeferred: false,
				includeUndecided: false,
				summaryMode: "deterministic",
			}),
		});

		expect(res.status).toBe(202);
		expect(mockScanReportRunner.start).toHaveBeenCalledWith({
			scanRunId: "s-1",
			title: "Filtered Report",
			summaryMode: "deterministic",
			generatedByUserId: "user-123",
		});
		expect(await res.json()).toMatchObject({
			report: { id: "report-1", status: "queued" },
		});
	});
});
