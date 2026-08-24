import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
import { ProcessCapacityExceededError } from "../modules/processes/web-process-capacity";
import type { RuntimeIsolationProviderFactory } from "../modules/runtime-isolation/runtime-isolation-provider-factory";
import { ProjectPathPolicyError } from "../security/project-path-policy";
import { createProjectsRoute } from "./projects.route";

const mockResolveProjectPath = vi.fn(async (projectPath: string) => {
	if (projectPath === "/invalid/path") {
		throw new ProjectPathPolicyError(
			"PROJECT_PATH_NOT_FOUND",
			"The requested project path does not exist.",
		);
	}
	return { canonicalPath: projectPath };
});

const PREFLIGHT_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

describe("Projects Route", () => {
	const mockProjectRepo = {
		listProjects: vi.fn().mockResolvedValue([
			{ id: "p-1", name: "Project 1", repoPath: "/Users/test/project-1" },
			{ id: "p-tmp", name: "Temporary", repoPath: "/tmp/phase42-case" },
		]),
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === PREFLIGHT_PROJECT_ID) {
				return {
					id: PREFLIGHT_PROJECT_ID,
					name: "Preflight Project",
					ownerUserId: "user-123",
					repoPath: process.cwd(),
				};
			}
			if (id === "p-1") {
				return {
					id: "p-1",
					name: "Project 1",
					ownerUserId: "user-123",
					repoPath: "/valid/path",
				};
			}
			if (id === "p-other-user") {
				return { id: "p-other-user", name: "Project Other", ownerUserId: "other-user" };
			}
			return null;
		}),
		findByRepoPath: vi.fn().mockImplementation(async (userId: string, repoPath: string) => {
			if (repoPath === "/duplicate/path") {
				return { id: "p-dup" };
			}
			return null;
		}),
		findByCanonicalRepoPath: vi.fn().mockImplementation(async (repoPath: string) => {
			if (repoPath === "/duplicate/path") return { id: "p-dup" };
			return null;
		}),
		createProject: vi.fn().mockResolvedValue({ id: "p-new", name: "New Project" }),
	};
	const mockProjectDeletionService = {
		deleteOwnedProject: vi.fn().mockResolvedValue({
			deletedProjectId: "p-1",
			deletedAt: new Date("2026-08-20T12:30:00.000Z"),
			artifactCleanup: "queued",
		}),
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
		createProjectsRoute({
			projectRepository: mockProjectRepo as any,
			projectDeletionService: mockProjectDeletionService as any,
			env: readAppEnv({ NODE_ENV: "test" }),
			resolveProjectPath: mockResolveProjectPath,
		}),
	);

	it("GET / returns project list", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.projects).toEqual([
			{
				id: "p-1",
				name: "Project 1",
				repoPath: "/Users/test/project-1",
				pathPolicy: { status: "allowed", reasonCode: null },
			},
		]);
	});

	it("GET /:projectId returns project details if owned by user", async () => {
		const res = await app.request("/p-1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.project.name).toBe("Project 1");
	});

	it("GET /:projectId returns 403 if project is owned by another user", async () => {
		const res = await app.request("/p-other-user");
		expect(res.status).toBe(403);
	});

	it("GET /:projectId returns 404 if project not found", async () => {
		const res = await app.request("/p-missing");
		expect(res.status).toBe(404);
	});

	it("DELETE /:projectId validates confirmation and delegates to the deletion service", async () => {
		const res = await app.request("/p-1", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ confirmation: "Project 1" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			deletedProjectId: "p-1",
			deletedAt: "2026-08-20T12:30:00.000Z",
			artifactCleanup: "queued",
		});
		expect(mockProjectDeletionService.deleteOwnedProject).toHaveBeenCalledWith({
			projectId: "p-1",
			userId: "user-123",
			confirmation: "Project 1",
		});
	});

	it("POST / creates new project", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "New Project",
				repoPath: "/valid/path",
				defaultBranch: "main",
			}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.project.id).toBe("p-new");
		expect(body.project.pathPolicy).toEqual({
			status: "allowed",
			reasonCode: null,
		});
		expect(mockProjectRepo.createProject).toHaveBeenCalledWith(
			expect.objectContaining({ name: "path", repoPath: "/valid/path" }),
		);
	});

	it("POST / derives the project name when name is omitted", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				repoPath: "/valid/path",
				defaultBranch: "main",
			}),
		});
		expect(res.status).toBe(201);
		expect(mockProjectRepo.createProject).toHaveBeenCalledWith(
			expect.objectContaining({ name: "path", repoPath: "/valid/path" }),
		);
	});

	it("POST / fails if repo path does not exist on disk", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "New Project",
				repoPath: "/invalid/path",
			}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("does not exist");
	});

	it("POST / accepts a repository anywhere on the filesystem", async () => {
		const unrestrictedApp = new Hono();
		unrestrictedApp.use("*", async (c, next) => {
			c.set("authUser", {
				userId: "user-123",
				email: "user@example.com",
				role: "member",
			});
			await next();
		});
		unrestrictedApp.onError((err, c) => {
			if (err instanceof HttpError) {
				return c.json({ message: err.message }, err.status as any);
			}
			return c.json({ message: err.message }, 500);
		});
		unrestrictedApp.route(
			"/",
			createProjectsRoute({
				projectRepository: mockProjectRepo as any,
				env: readAppEnv({ NODE_ENV: "test" }),
				resolveProjectPath: mockResolveProjectPath,
			}),
		);

		const res = await unrestrictedApp.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repoPath: "/outside/project" }),
		});
		expect(res.status).toBe(201);
	});

	it("POST /folder-picker requires an admin role", async () => {
		const res = await app.request("/folder-picker", { method: "POST" });
		expect(res.status).toBe(403);
	});

	it("POST / fails if path already registered", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "New Project",
				repoPath: "/duplicate/path",
			}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.message).toContain("already registered");
	});

	it(
		"POST /:projectId/scans/preflight returns a server-owned versioned result",
		async () => {
			const res = await app.request(
				`/${PREFLIGHT_PROJECT_ID}/scans/preflight`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ profile: "baseline", runner: "host" }),
				},
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.preflight).toEqual(
				expect.objectContaining({
					schemaVersion: 1,
					profileId: "baseline",
					mode: "enforced",
					bindingHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
					preflightHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
				}),
			);
			expect(body.executionPlan).toEqual(
				expect.objectContaining({
					planHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
					profileId: "baseline",
					sourceSnapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
				}),
			);
		},
		30_000,
	);

	it(
		"resolves persisted runtime settings for every preflight request",
		async () => {
			const staleEnv = readAppEnv({ NODE_ENV: "test" });
			staleEnv.scanExecutionMode = "docker";
			staleEnv.scanDockerImage = "missing-stale-toolbox:image";
			const resolveRuntimeEnv = vi.fn(async () => ({
				...staleEnv,
				scanExecutionMode: "host" as const,
			}));
			const liveSettingsApp = new Hono();
			liveSettingsApp.use("*", async (c, next) => {
				c.set("authUser", {
					userId: "user-123",
					email: "user@example.com",
					role: "member",
				});
				await next();
			});
			liveSettingsApp.route(
				"/",
				createProjectsRoute({
					projectRepository: mockProjectRepo as any,
					env: staleEnv,
					resolveRuntimeEnv,
					resolveProjectPath: mockResolveProjectPath,
				}),
			);

			const res = await liveSettingsApp.request(
				`/${PREFLIGHT_PROJECT_ID}/scans/preflight`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ profile: "baseline", runner: "host" }),
				},
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.executionPlan.orchestrator.runner).toBe("host");
			expect(resolveRuntimeEnv).toHaveBeenCalledOnce();
		},
		15_000,
	);

	it(
		"reports an unavailable isolated runtime before a runtime scan is queued",
		async () => {
			const resolveRuntimeIsolationProviderFactory = vi.fn(() => null);
			const runtimeApp = new Hono();
			runtimeApp.use("*", async (c, next) => {
				c.set("authUser", {
					userId: "user-123",
					email: "user@example.com",
					role: "member",
				});
				await next();
			});
			runtimeApp.route(
				"/",
				createProjectsRoute({
					projectRepository: mockProjectRepo as any,
					env: readAppEnv({ NODE_ENV: "test" }),
					resolveProjectPath: mockResolveProjectPath,
					resolveRuntimeIsolationProviderFactory,
				}),
			);

			const res = await runtimeApp.request(
				`/${PREFLIGHT_PROJECT_ID}/scans/preflight`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						profile: "runtime-passive",
						runner: "host",
						consentProjectCodeExecution: true,
					}),
				},
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.preflight).toMatchObject({
				status: "blocked",
				limitationCodes: expect.arrayContaining([
					"runtime_isolation_provider_unavailable",
				]),
			});
			expect(body.preflight.checks).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						kind: "sandbox_availability",
						status: "blocked",
						reasonCode: "runtime_isolation_provider_unavailable",
					}),
				]),
			);
			expect(body.executionPlan.blockerCodes).toContain(
				"runtime_isolation_provider_unavailable",
			);
			expect(resolveRuntimeIsolationProviderFactory).toHaveBeenCalledOnce();
		},
		30_000,
	);

	it(
		"builds a stable V3 preview when the isolated runtime is configured",
		async () => {
			const digest = `sha256:${"c".repeat(64)}`;
			const dispose = vi.fn(async () => undefined);
			const cleanupSourceSnapshot = vi.fn(async () => undefined);
			const runtimeIsolationProviderFactory = vi.fn(
				async (
					input: Parameters<RuntimeIsolationProviderFactory>[0],
				) => ({
					plan: {
						pluginId: "build.npm",
						repoPath: input.sourceSnapshot.projectPath,
						scriptName: "start",
						script: "node server.js",
						packageManager: "npm" as const,
						command: ["npm", "run", "start"],
						env: {},
						requiresProjectCodeConsent: false,
						port: 18080,
						origin: "http://127.0.0.1:18080",
						readinessPaths: ["/"],
						warnings: [],
					},
					runtimeIsolationPlanning: {
						status: "ready" as const,
						planHash: digest,
						plan: {
							schemaVersion: 1 as const,
							profileId: input.profileId,
							source: {
								sourceSnapshotDigest: `sha256:${input.sourceSnapshot.snapshotDigest}`,
								runtimeProjectionDigest: digest,
								projectionPolicyVersion: 1 as const,
							},
							recipe: {
								recipeHash: digest,
								startPlannerId: "build.npm" as const,
							},
							dependency: {
								adapterId: "npm-package-lock-v1" as const,
								policyVersion: 1 as const,
								lockDigest: digest,
							},
							images: {
								namespaceOwnerImageDigest: digest,
								nodeRuntimeImageDigest: digest,
								materializerImageDigest: digest,
								registryProxyImageDigest: digest,
								probeImageDigest: digest,
								httpExecutorImageDigest: digest,
								databaseImageDigest: null,
								scannerImageDigests: { nuclei: digest, zap: digest },
							},
							start: {
								executable: "npm" as const,
								args: ["run", "start"],
								port: 18080 as const,
								readinessPaths: ["/"],
							},
							database: {
								mode: "none" as const,
								policyVersion: 1 as const,
								bindings: [],
							},
							environment: { policyVersion: 1 as const },
							network: {
								kind: "container_namespace" as const,
								policyVersion: 1 as const,
							},
							limits: {
								policyVersion: 1 as const,
								targetMemoryMiB: 1024 as const,
								targetPids: 256 as const,
							},
							cleanup: {
								required: true as const,
								policyVersion: 1 as const,
							},
							dockerDaemonIdentityHash: digest,
							qualificationHash: digest,
						},
					},
					dispose,
					prepare: async () => {
						throw new Error("preview must not start a runtime target");
					},
				}),
			);
			const runtimeApp = new Hono();
			runtimeApp.use("*", async (c, next) => {
				c.set("authUser", {
					userId: "user-123",
					email: "user@example.com",
					role: "member",
				});
				await next();
			});
			runtimeApp.route(
				"/",
				createProjectsRoute({
					projectRepository: mockProjectRepo as any,
					env: readAppEnv({ NODE_ENV: "test" }),
					resolveProjectPath: mockResolveProjectPath,
					runtimeIsolationProviderFactory,
					resolveFullScanTarget: async () => ({
						digest: "d".repeat(64),
						sourceRevision: "e".repeat(40),
						changedFileCount: 0,
						scopeContentDigest: "f".repeat(64),
					}),
					materializeScopedSourceSnapshot: async () => ({
						rootPath: process.cwd(),
						projectPath: process.cwd(),
						sourceRevision: "e".repeat(40),
						snapshotDigest: "f".repeat(64),
						cleanup: cleanupSourceSnapshot,
					}),
				}),
			);
			const request = () =>
				runtimeApp.request(`/${PREFLIGHT_PROJECT_ID}/scans/preflight`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						profile: "api-readonly",
						allowExperimental: true,
						consentProjectCodeExecution: true,
					}),
				});

			const firstResponse = await request();
			const secondResponse = await request();
			expect(firstResponse.status).toBe(200);
			expect(secondResponse.status).toBe(200);
			const first = await firstResponse.json();
			const second = await secondResponse.json();
			expect(first.preflight).toMatchObject({
				schemaVersion: 2,
				binding: { runtimeIsolation: { status: "ready" } },
			});
			expect(first.executionPlan).toMatchObject({
				schemaVersion: 3,
				runtimeIsolation: { planHash: digest },
			});
			expect(first.executionPlan.planHash).toBe(
				second.executionPlan.planHash,
			);
			expect(runtimeIsolationProviderFactory).toHaveBeenCalledTimes(2);
			expect(runtimeIsolationProviderFactory).toHaveBeenCalledWith(
				expect.objectContaining({
					scannerImageRequirements: [
						{ role: "schemathesis", required: true },
					],
				}),
			);
			expect(dispose).toHaveBeenCalledTimes(2);
			expect(cleanupSourceSnapshot).toHaveBeenCalledTimes(2);
		},
		60_000,
	);

	it("POST /:projectId/scans rejects a step timeout above the configured maximum", async () => {
		const res = await app.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ timeoutSec: 3_601 }),
		});

		expect(res.status).toBe(400);
	});

	it("resolves persisted runtime settings for every scan start request", async () => {
		const staleEnv = readAppEnv({ NODE_ENV: "test" });
		const resolveRuntimeEnv = vi.fn(async () => ({
			...staleEnv,
			webScanStepTimeoutMaxSec: 120,
		}));
		const liveSettingsApp = new Hono();
		liveSettingsApp.use("*", async (c, next) => {
			c.set("authUser", {
				userId: "user-123",
				email: "user@example.com",
				role: "member",
			});
			await next();
		});
		liveSettingsApp.onError((error, c) => {
			if (error instanceof HttpError) {
				return c.json({ message: error.message }, error.status as never);
			}
			return c.json({ message: error.message }, 500);
		});
		liveSettingsApp.route(
			"/",
			createProjectsRoute({
				projectRepository: mockProjectRepo as any,
				env: staleEnv,
				resolveRuntimeEnv,
				resolveProjectPath: mockResolveProjectPath,
			}),
		);

		const res = await liveSettingsApp.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ timeoutSec: 121 }),
		});

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			message: "timeoutSec must be at most 120.",
		});
		expect(resolveRuntimeEnv).toHaveBeenCalledOnce();
	});

	it("POST /:projectId/scans admits a queued scan and returns 202 without waiting", async () => {
		const scanRepository = {
			createScanRun: vi.fn().mockResolvedValue({ id: "s-queued" }),
			createScanEvent: vi.fn().mockResolvedValue({ id: "e-queued" }),
		};
		let releaseLaunch: (() => void) | undefined;
		const launchStarted = new Promise<void>((resolve) => {
			releaseLaunch = resolve;
		});
		const scanSupervisor = {
			launch: vi.fn(async (_scanRunId: string, _args: string[]) =>
				releaseLaunch?.(),
			),
		};
		const scanApp = new Hono();
		scanApp.use("*", async (c, next) => {
			c.set("authUser", { userId: "user-123", email: "user@example.com", role: "member" });
			await next();
		});
		scanApp.route(
			"/",
			createProjectsRoute({
				projectRepository: mockProjectRepo as any,
					scanRepository: scanRepository as any,
					scanSupervisor: scanSupervisor as any,
					env: readAppEnv({ NODE_ENV: "test" }),
					resolveProjectPath: mockResolveProjectPath,
				}),
		);

		const res = await scanApp.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
		body: JSON.stringify({
			profile: "baseline",
			expectedPreflightBindingHash: `sha256:${"a".repeat(64)}`,
			expectedPlanHash: `sha256:${"b".repeat(64)}`,
			}),
		});
		await launchStarted;
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({
			scan: { id: "s-queued", status: "queued", profile: "baseline" },
			profileOutcome: "pending",
		});
		expect(scanRepository.createScanRun).toHaveBeenCalledTimes(1);
		expect(scanRepository.createScanRun).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					finalReportRequest: {
						requested: true,
						title: "baseline 最終セキュリティレポート",
					},
				}),
			}),
		);
		const launchedArgs = scanSupervisor.launch.mock.calls[0]?.[1];
		expect(launchedArgs?.slice(0, 4)).toEqual([
			"bun",
			"--no-env-file",
			"run",
			"api/cli/scan-profile.ts",
		]);
		expect(scanSupervisor.launch).toHaveBeenCalledWith(
			"s-queued",
			expect.arrayContaining([
				"--no-env-file",
				"--scan-run-id",
				"s-queued",
				"--expected-preflight-binding-hash",
				`sha256:${"a".repeat(64)}`,
				"--expected-plan-hash",
				`sha256:${"b".repeat(64)}`,
			]),
		);
	});

	it("rejects a changed catalog entry before creating a queued scan", async () => {
		const scanRepository = {
			createScanRun: vi.fn(),
			createScanEvent: vi.fn(),
		};
		const scanApp = new Hono();
		scanApp.use("*", async (c, next) => {
			c.set("authUser", { userId: "user-123", email: "user@example.com", role: "member" });
			await next();
		});
		scanApp.onError((error, c) =>
			error instanceof HttpError
				? c.json({ message: error.message }, error.status as never)
				: c.json({ message: error.message }, 500),
		);
		scanApp.route(
			"/",
			createProjectsRoute({
				projectRepository: mockProjectRepo as any,
				scanRepository: scanRepository as any,
				scanSupervisor: { launch: vi.fn() } as any,
				env: readAppEnv({ NODE_ENV: "test" }),
				resolveProjectPath: mockResolveProjectPath,
			}),
		);
		const res = await scanApp.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "baseline",
				expectedCatalogEntryHash: `sha256:${"0".repeat(64)}`,
			}),
		});
		expect(res.status).toBe(409);
		expect(scanRepository.createScanRun).not.toHaveBeenCalled();
	});

	it("POST /:projectId/scans returns 429 when the Web process queue is full", async () => {
		const scanRepository = {
			createScanRun: vi.fn().mockResolvedValue({ id: "s-rejected" }),
			createScanEvent: vi.fn().mockResolvedValue({ id: "e-rejected" }),
		};
		const scanSupervisor = {
			launch: vi.fn(async () => {
				throw new ProcessCapacityExceededError("Web process queue is full.");
			}),
		};
		const scanApp = new Hono();
		scanApp.use("*", async (c, next) => {
			c.set("authUser", {
				userId: "user-123",
				email: "user@example.com",
				role: "member",
			});
			await next();
		});
		scanApp.onError((error, c) => {
			if (error instanceof HttpError) {
				return c.json({ message: error.message }, error.status as never);
			}
			return c.json({ message: error.message }, 500);
		});
		scanApp.route(
			"/",
			createProjectsRoute({
				projectRepository: mockProjectRepo as any,
				scanRepository: scanRepository as any,
				scanSupervisor: scanSupervisor as any,
				env: readAppEnv({ NODE_ENV: "test" }),
				resolveProjectPath: mockResolveProjectPath,
			}),
		);

		const res = await scanApp.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				profile: "baseline",
				expectedPreflightBindingHash: `sha256:${"a".repeat(64)}`,
			}),
		});

		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ message: "Web process queue is full." });
	});
});
