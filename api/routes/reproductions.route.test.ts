import path from "node:path";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../modules/auth/errors";
import { createReproductionProfiles } from "../modules/reproductions/profiles";
import { createReproductionsRoute } from "./reproductions.route";

function streamText(text: string) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

describe("Reproductions Route", () => {
	const mockFindingRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "f-1") {
				return {
					id: "f-1",
					projectId: "p-1",
					scanRunId: "s-1",
					sourceTool: "semgrep",
					ruleId: "rules-1",
					primaryLocation: { path: "src/index.js" },
				};
			}
			return null;
		}),
	};

	const mockProjectRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return {
					id: "p-1",
					ownerUserId: "user-123",
					repoPath: process.cwd(),
				};
			}
			return null;
		}),
	};

	// We can mock ReproductionRepository methods by mocking the DB query calls
	const mockDb = {
		query: {
			reproductionRuns: {
				findFirst: vi.fn().mockImplementation(async (options: any) => {
					return {
						id: "run-1",
						projectId: "p-1",
						scanRunId: "s-1",
						findingId: "f-1",
						profileId: "semgrep-path-recheck",
						status: "completed",
						outcome: "reproduced",
						runner: "docker",
					};
				}),
				findMany: vi.fn().mockResolvedValue([
					{ id: "run-1", status: "completed", outcome: "reproduced" },
				]),
			},
			reproductionArtifacts: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "art-1", kind: "stdout", format: "text", path: "run-1/logs/stdout.log" },
				]),
			},
			reproductionEvidence: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "ev-1", title: "Observed again" },
				]),
			},
		},
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
		createReproductionsRoute({
			db: mockDb as any,
			findingRepository: mockFindingRepo as any,
			projectRepository: mockProjectRepo as any,
			reproductionProfiles: createReproductionProfiles({
				includeOptionalSemgrep: true,
			}),
		}),
	);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("GET /findings/:findingId/reproduction-profiles returns list of profiles and applicability status", async () => {
		const res = await app.request("/findings/f-1/reproduction-profiles");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.profiles).toBeDefined();
		const semgrep = body.profiles.find((p: any) => p.id === "semgrep-path-recheck");
		expect(semgrep.isApplicable).toBe(true);
		const gitleaks = body.profiles.find((p: any) => p.id === "gitleaks-recheck");
		expect(gitleaks.isApplicable).toBe(false);
	});

	it("GET /findings/:findingId/reproductions returns run history list", async () => {
		const res = await app.request("/findings/f-1/reproductions");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reproductions).toBeDefined();
		expect(body.reproductions[0].id).toBe("run-1");
	});

	it("POST /findings/:findingId/reproductions triggers reproduction CLI process bridge and returns outcome", async () => {
		const mockCliResult = {
			ok: true,
			reproductionRunId: "run-new",
			findingId: "f-1",
			profileId: "semgrep-path-recheck",
			status: "completed",
			outcome: "reproduced",
			runner: "docker",
		};

		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
			capturedArgs = args;
			return {
				exited: Promise.resolve(0),
				stdout: streamText(JSON.stringify(mockCliResult)),
				stderr: streamText(""),
			} as any;
		});

		const res = await app.request("/findings/f-1/reproductions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profileId: "semgrep-path-recheck",
				runner: "docker",
				dockerImage: "test-toolbox:local",
				network: "none",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.reproductionRunId).toBe("run-new");
		expect(body.outcome).toBe("reproduced");
		expect(capturedArgs).toContain("api/cli/repro-finding.ts");
		expect(capturedArgs).toContain("--finding-id");
		expect(capturedArgs).toContain("f-1");
		expect(capturedArgs).not.toContain("--command");
	});

	it("rejects an unavailable project path before validating a reproduction", async () => {
		mockProjectRepo.findById.mockResolvedValueOnce({
			id: "p-1",
			ownerUserId: "user-123",
			repoPath: path.join(
				process.cwd(),
				".tmp",
				"missing-reproduction-route-project",
			),
		});
		const res = await app.request("/findings/f-1/reproductions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).message).toContain("does not exist");
	});

	it("POST /findings/:findingId/reproductions returns persisted failed run body as 200", async () => {
		const mockCliResult = {
			ok: false,
			reproductionRunId: "run-failed",
			findingId: "f-1",
			profileId: "semgrep-path-recheck",
			status: "failed",
			outcome: "error",
			runner: "docker",
			message: "Docker image not found: test-toolbox:local",
		};

		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			return {
				exited: Promise.resolve(0),
				stdout: streamText(JSON.stringify(mockCliResult)),
				stderr: streamText(""),
			} as any;
		});

		const res = await app.request("/findings/f-1/reproductions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profileId: "semgrep-path-recheck",
				runner: "docker",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(false);
		expect(body.reproductionRunId).toBe("run-failed");
		expect(body.status).toBe("failed");
		expect(body.outcome).toBe("error");
	});

	it("POST /findings/:findingId/reproductions fails if profile is not applicable", async () => {
		const res = await app.request("/findings/f-1/reproductions", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profileId: "gitleaks-recheck",
			}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("not applicable");
	});
});
