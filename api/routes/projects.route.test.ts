import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createProjectsRoute } from "./projects.route";
import { HttpError } from "../modules/auth/errors";

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
		},
		access: mockAccess,
	};
});

describe("Projects Route", () => {
	const mockProjectRepo = {
		listProjects: vi.fn().mockResolvedValue([{ id: "p-1", name: "Project 1" }]),
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
		expect(body.projects).toEqual([{ id: "p-1", name: "Project 1" }]);
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
});
