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
	});
});
