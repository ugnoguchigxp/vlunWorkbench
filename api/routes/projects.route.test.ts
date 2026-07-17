import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
import { createProjectsRoute } from "./projects.route";

vi.mock("node:fs/promises", () => {
	const mockAccess = vi.fn().mockImplementation(async (path: string) => {
		if (path === "/invalid/path") {
			throw new Error("ENOENT");
		}
		return Promise.resolve();
	});
	return {
		default: {
			access: mockAccess,
			realpath: vi.fn(async (value: string) => value),
		},
		access: mockAccess,
		realpath: vi.fn(async (value: string) => value),
	};
});

describe("Projects Route", () => {
	const mockProjectRepo = {
		listProjects: vi.fn().mockResolvedValue([
			{ id: "p-1", name: "Project 1", repoPath: "/Users/test/project-1" },
			{ id: "p-tmp", name: "Temporary", repoPath: "/tmp/phase42-case" },
		]),
		findById: vi.fn().mockImplementation(async (id: string) => {
			if (id === "p-1") {
				return { id: "p-1", name: "Project 1", ownerUserId: "user-123" };
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
	app.route("/", createProjectsRoute({ projectRepository: mockProjectRepo as any }));

	it("GET / returns project list", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.projects).toEqual([
			{ id: "p-1", name: "Project 1", repoPath: "/Users/test/project-1" },
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
		expect(body.message).toContain("does not exist on disk");
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
			}),
		);

		const res = await scanApp.request("/p-1/scans", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ profile: "baseline" }),
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
			expect.arrayContaining(["--scan-run-id", "s-queued"]),
		);
	});
});
