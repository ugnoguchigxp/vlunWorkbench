import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createScanReportsRoute } from "./scan-reports.route";
import { HttpError } from "../modules/auth/errors";

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
				};
			}
			return null;
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
		]),
	};

	const mockArtifactStorage = {
		readTextArtifact: vi.fn().mockResolvedValue("# Security Report Content"),
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
		createScanReportsRoute({
			scanReportRepository: mockScanReportRepo as any,
			scanRepository: mockScanRepo as any,
			projectRepository: mockProjectRepo as any,
			artifactRepository: mockArtifactRepo as any,
			artifactStorage: mockArtifactStorage as any,
		}),
	);

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
		expect(res.headers.get("Content-Disposition")).toContain('attachment; filename="security-report-r-1.md"');
		const body = await res.text();
		expect(body).toBe("# Security Report Content");
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
