import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
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

describe("Projects Route", () => {
	const mockProjectRepo = {
		listProjects: vi.fn().mockResolvedValue([
			{ id: "p-1", name: "Project 1", repoPath: "/Users/test/project-1" },
			{ id: "p-tmp", name: "Temporary", repoPath: "/tmp/phase42-case" },
		]),
		findById: vi.fn().mockImplementation(async (id: string) => {
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

	it("POST /:projectId/scans/preflight returns a server-owned versioned result", async () => {
		const res = await app.request("/p-1/scans/preflight", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ profile: "baseline", runner: "host" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.preflight).toEqual(
			expect.objectContaining({
				schemaVersion: 1,
				profileId: "baseline",
				mode: "shadow",
				bindingHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
				preflightHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			}),
		);
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
			launch: vi.fn(async () => releaseLaunch?.()),
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
			}),
		});
		await launchStarted;
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({
			scan: { id: "s-queued", status: "queued", profile: "baseline" },
			profileOutcome: "pending",
		});
		expect(scanRepository.createScanRun).toHaveBeenCalledTimes(1);
		expect(scanSupervisor.launch).toHaveBeenCalledWith(
			"s-queued",
			expect.arrayContaining([
				"--scan-run-id",
				"s-queued",
				"--expected-preflight-binding-hash",
				`sha256:${"a".repeat(64)}`,
			]),
		);
	});
});
