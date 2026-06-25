import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../modules/auth/errors";
import { createDynamicRoute } from "./dynamic.route";

describe("Dynamic Route", () => {
	const mockFindingRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "f-1") {
				return {
					id: "f-1",
					projectId: "p-1",
					scanRunId: "s-1",
					sourceTool: "semgrep",
					ruleId: "rules-1",
				};
			}
			return null;
		}),
	};

	const mockProjectRepo = {
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return { id: "p-1", ownerUserId: "user-123", repoPath: "/repo" };
			}
			return null;
		}),
	};

	// Mock DB queries for DynamicRepository
	const mockDb = {
		insert: vi.fn().mockReturnThis(),
		values: vi.fn().mockReturnThis(),
		returning: vi.fn().mockImplementation(() => {
			return [
				{
					id: "cfg-1",
					projectId: "p-1",
					profileId: "bun-test",
					dynamicKind: "test",
					displayName: "Bun Test",
					commandJson: ["bun", "test"],
				},
			];
		}),
		update: vi.fn().mockReturnThis(),
		set: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		query: {
			dynamicProfileConfigs: {
				findFirst: vi.fn().mockImplementation(async (options: any) => {
					return {
						id: "cfg-1",
						projectId: "p-1",
						profileId: "bun-test",
						dynamicKind: "test",
						displayName: "Bun Test",
						enabled: true,
						commandJson: ["bun", "test"],
						workingDirectory: "",
						timeoutSec: 120,
						network: "none",
						memory: null,
						cpus: null,
						writableWorkdir: true,
						allowProjectScripts: false,
						expectedArtifactsJson: [],
					};
				}),
				findMany: vi.fn().mockResolvedValue([
					{
						id: "cfg-1",
						projectId: "p-1",
						profileId: "bun-test",
						dynamicKind: "test",
						displayName: "Bun Test",
						enabled: true,
						commandJson: ["bun", "test"],
					},
				]),
			},
			dynamicRuns: {
				findFirst: vi.fn().mockImplementation(async (options: any) => {
					return {
						id: "run-1",
						projectId: "p-1",
						profileConfigId: "cfg-1",
						profileId: "bun-test",
						dynamicKind: "test",
						status: "completed",
						outcome: "passed",
						runner: "docker",
					};
				}),
				findMany: vi.fn().mockResolvedValue([
					{
						id: "run-1",
						status: "completed",
						outcome: "passed",
						dynamicKind: "test",
					},
				]),
			},
			dynamicArtifacts: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "art-1", kind: "stdout", format: "text", path: "run-1/logs/stdout.log" },
				]),
			},
			dynamicEvidence: {
				findMany: vi.fn().mockResolvedValue([
					{ id: "ev-1", kind: "dynamic-test-log", title: "Test PASSED" },
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
		createDynamicRoute({
			db: mockDb as any,
			findingRepository: mockFindingRepo as any,
			projectRepository: mockProjectRepo as any,
		}),
	);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("GET /projects/:projectId/dynamic-profiles returns profiles config list", async () => {
		const res = await app.request("/projects/p-1/dynamic-profiles");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.configs).toHaveLength(1);
		expect(body.configs[0].profileId).toBe("bun-test");
	});

	it("POST /projects/:projectId/dynamic-profiles creates dynamic profile", async () => {
		const res = await app.request("/projects/p-1/dynamic-profiles", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				profileId: "npm-test",
				dynamicKind: "test",
				displayName: "NPM Test",
				commandJson: ["npm", "test"],
				allowProjectScripts: true,
			}),
		});

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.config).toBeDefined();
	});

	it("POST /projects/:projectId/dynamic-profiles rejects unsafe profile commands", async () => {
		const res = await app.request("/projects/p-1/dynamic-profiles", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				profileId: "unsafe",
				dynamicKind: "test",
				displayName: "Unsafe",
				commandJson: ["bash", "-c", "echo unsafe"],
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("Profile command policy validation failed");
	});

	it("PATCH /projects/:projectId/dynamic-profiles/:profileId rejects unsafe merged profile policy", async () => {
		const res = await app.request("/projects/p-1/dynamic-profiles/bun-test", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				commandJson: ["npm", "test"],
				allowProjectScripts: false,
			}),
		});

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("allow_project_scripts");
	});

	it("POST /projects/:projectId/dynamic-runs invokes CLI process via Bun.spawn", async () => {
		const mockSpawnResult = {
			ok: true,
			dynamicRunId: "run-1",
			status: "completed",
			outcome: "passed",
		};

		const spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
			return {
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(JSON.stringify(mockSpawnResult)));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
				exited: Promise.resolve(0),
			} as any;
		});

		const res = await app.request("/projects/p-1/dynamic-runs", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				profileId: "bun-test",
				runner: "docker",
			}),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.dynamicRunId).toBe("run-1");

		expect(spawnSpy).toHaveBeenCalled();
		const spawnArgs = spawnSpy.mock.calls[0][0];
		expect(spawnArgs).toContain("api/cli/dynamic-run.ts");
	});

	it("GET /dynamic-runs/:runId/artifacts returns artifacts and evidence", async () => {
		const res = await app.request("/dynamic-runs/run-1/artifacts");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.artifacts).toHaveLength(1);
		expect(body.evidence).toHaveLength(1);
		expect(body.evidence[0].title).toBe("Test PASSED");
	});
});
