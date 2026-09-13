import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAppEnv } from "../app/env";
import { HttpError } from "../modules/auth/errors";
import { createProjectsRoute } from "../routes/projects.route";
import { authorizeConfiguredProjectPath, withProjectPathRoots } from "./configured-project-path";

describe("configured project authority", () => {
	let root: string;
	beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "configured-roots-")); });
	afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
	it("keeps concurrent request and MCP root policies isolated", async () => {
		const result = await Promise.allSettled([
			withProjectPathRoots([root], async () => { await Promise.resolve(); return authorizeConfiguredProjectPath(root); }),
			withProjectPathRoots([], async () => { await Promise.resolve(); return authorizeConfiguredProjectPath(root); }),
		]);
		expect(result.map((entry) => entry.status)).toEqual(["fulfilled", "rejected"]);
	});

	it("rejects empty roots, prefix siblings and symlink escapes", async () => {
		const allowed = path.join(root, "safe");
		const outside = path.join(root, "safe-other");
		await fs.mkdir(allowed); await fs.mkdir(outside);
		await fs.symlink(outside, path.join(allowed, "escape"));
		await expect(authorizeConfiguredProjectPath(allowed, [])).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
		await expect(authorizeConfiguredProjectPath(outside, [allowed])).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
		await expect(authorizeConfiguredProjectPath(path.join(allowed, "escape"), [allowed])).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
		await expect(authorizeConfiguredProjectPath(allowed, [allowed])).resolves.toMatchObject({ canonicalPath: await fs.realpath(allowed) });
	});
	it("blocks registration and existing-project execution after roots change, without launching", async () => {
		const env = readAppEnv({ NODE_ENV: "test", PROJECT_ALLOWED_ROOTS: root });
		const repo = {
			findById: vi.fn(async () => ({ id: "p", ownerUserId: "owner", repoPath: root })),
			listProjects: vi.fn(async () => [{ id: "p", ownerUserId: "owner", repoPath: root }]),
			createProject: vi.fn(),
		};
		const launch = vi.fn();
		const createScanRun = vi.fn();
		const app = new Hono();
		app.use("*", async (c, next) => { c.set("authUser", { userId: c.req.header("x-test-user") ?? "owner", email: "owner@example.test", role: "member" }); await next(); });
		app.onError((e, c) => c.json({ message: e.message }, e instanceof HttpError ? e.status as 400 : 500));
		app.route("/", createProjectsRoute({ env, projectRepository: repo as never, scanSupervisor: { launch } as never, scanRepository: { createScanRun } as never }));
		expect((await (await app.request("/")).json()).projects[0].pathPolicy.status).toBe("allowed");
		env.projectAllowedRoots = [];
		expect((await (await app.request("/")).json()).projects[0].pathPolicy.status).toBe("blocked");
		const post = (url: string, body: unknown, user = "owner") => app.request(url, { method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body) });
		expect((await post("/", { repoPath: root })).status).toBe(400);
		expect((await post("/p/scans", {})).status).toBe(400);
		expect((await post("/p/scans", {}, "other")).status).toBe(403);
		expect(repo.createProject).not.toHaveBeenCalled(); expect(launch).not.toHaveBeenCalled(); expect(createScanRun).not.toHaveBeenCalled();
	});
});
