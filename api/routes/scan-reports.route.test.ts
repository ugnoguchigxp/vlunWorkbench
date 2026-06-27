import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../modules/auth/errors";
import { createScanReportsRoute } from "./scan-reports.route";

describe("Scan Reports Route", () => {
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
				return { id: "s-1", projectId: "p-1" };
			}
			return null;
		}),
	};

	const mockScanReportRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "r-1") {
				return {
					id: "r-1",
					scanRunId: "s-1",
					format: "markdown",
					title: "Security Report",
					status: "completed",
					artifactId: "a-1",
					options: {},
				};
			}
			if (id === "r-failed") {
				return {
					id: "r-failed",
					scanRunId: "s-1",
					format: "markdown",
					title: "Failed Report",
					status: "failed",
					artifactId: null,
					options: {},
				};
			}
			if (id === "r-mismatch") {
				return {
					id: "r-mismatch",
					scanRunId: "s-1",
					format: "markdown",
					title: "Mismatched Report",
					status: "completed",
					artifactId: "a-mismatch",
					options: {},
				};
			}
			if (id === "r-missing-file") {
				return {
					id: "r-missing-file",
					scanRunId: "s-1",
					format: "markdown",
					title: "Missing File Report",
					status: "completed",
					artifactId: "a-missing-file",
					options: {
						includeFalsePositives: false,
						includeDeferred: true,
						includeUndecided: true,
					},
				};
			}
			return null;
		}),
		updateReportStatus: vi.fn().mockResolvedValue({
			id: "r-missing-file",
			status: "completed",
			artifactId: "a-regenerated",
		}),
	};

	const mockArtifactRepo = {
		listArtifacts: vi.fn().mockResolvedValue([
			{
				id: "a-1",
				kind: "report",
				format: "markdown",
				path: "reports/report-1.md",
				metadata: { reportId: "r-1" },
			},
			{
				id: "a-mismatch",
				kind: "raw_result",
				format: "json",
				path: "raw/result.json",
				metadata: {},
			},
			{
				id: "a-missing-file",
				kind: "report",
				format: "markdown",
				path: "reports/missing.md",
				metadata: { reportId: "r-missing-file" },
			},
		]),
		createArtifact: vi.fn().mockResolvedValue({
			id: "a-regenerated",
			kind: "report",
			format: "markdown",
			path: "s-1/reports/report-r-missing-file.md",
			metadata: { reportId: "r-missing-file", regenerated: true },
		}),
	};

	const mockArtifactStorage = {
		readTextArtifact: vi.fn().mockImplementation(async (path: string) => {
			if (path === "reports/missing.md") {
				const err = new Error("missing file") as NodeJS.ErrnoException;
				err.code = "ENOENT";
				throw err;
			}
			return "# Security Report Content";
		}),
		saveTextArtifact: vi.fn().mockResolvedValue({
			path: "s-1/reports/report-r-missing-file.md",
			sha256: "sha-regenerated",
			sizeBytes: 27,
		}),
	};
	const mockBuildMarkdownReport = vi
		.fn()
		.mockResolvedValue("# Regenerated Report Content");

	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", {
			userId: "user-123",
			email: "user@example.com",
			role: "member",
		});
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
		createScanReportsRoute({
			scanReportRepository: mockScanReportRepo as any,
			scanRepository: mockScanRepo as any,
			projectRepository: mockProjectRepo as any,
			artifactRepository: mockArtifactRepo as any,
			artifactStorage: mockArtifactStorage as any,
			db: {} as any,
			buildMarkdownReport: mockBuildMarkdownReport as any,
		}),
	);

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("GET /:id returns report metadata", async () => {
		const res = await app.request("/r-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.report.id).toBe("r-1");
	});

	it("GET /:id/download downloads completed report", async () => {
		const res = await app.request("/r-1/download");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/markdown");
		expect(res.headers.get("Content-Disposition")).toContain(
			'attachment; filename="security-report-r-1.md"',
		);
		const body = await res.text();
		expect(body).toBe("# Security Report Content");
	});

	it("GET /:id/download regenerates a missing report artifact file", async () => {
		const res = await app.request("/r-missing-file/download");
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toBe("# Regenerated Report Content");
		expect(mockBuildMarkdownReport).toHaveBeenCalledWith(
			expect.anything(),
			"s-1",
			expect.objectContaining({
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
				title: "Missing File Report",
			}),
		);
		expect(mockArtifactStorage.saveTextArtifact).toHaveBeenCalledWith(
			"s-1",
			"reports",
			"# Regenerated Report Content",
			"report-r-missing-file.md",
		);
		expect(mockArtifactRepo.createArtifact).toHaveBeenCalledWith(
			expect.objectContaining({
				scanRunId: "s-1",
				kind: "report",
				format: "markdown",
				path: "s-1/reports/report-r-missing-file.md",
				metadata: { reportId: "r-missing-file", regenerated: true },
			}),
		);
		expect(mockScanReportRepo.updateReportStatus).toHaveBeenCalledWith(
			"r-missing-file",
			"completed",
			expect.objectContaining({ artifactId: "a-regenerated" }),
		);
	});

	it("GET /:id/download returns 400 for failed reports", async () => {
		const res = await app.request("/r-failed/download");
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toBe("Only completed reports can be downloaded");
	});

	it("GET /:id/download rejects non-report artifacts", async () => {
		const res = await app.request("/r-mismatch/download");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.message).toBe("Report artifact metadata mismatch");
	});
});
