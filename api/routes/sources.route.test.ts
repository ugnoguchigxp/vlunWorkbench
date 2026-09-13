import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourcesRoute } from "./sources.route";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
	);
});

const createMemberApp = () => {
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", {
			userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
			email: "member@example.com",
			role: "member",
		});
		await next();
	});
	app.route(
		"/sources",
		createSourcesRoute({
			contentRoot: path.join(os.tmpdir(), "unused-member-source-root"),
			sourceRepository: {} as never,
		}),
	);
	app.onError((error, c) =>
		c.json(
			{ message: error.message },
			("status" in error ? error.status : 500) as 403 | 500,
		),
	);
	return app;
};

async function createAdminApp() {
	const contentRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sources-route-"));
	roots.push(contentRoot);
	await execFileAsync("git", ["-C", contentRoot, "init", "-q"]);
	await execFileAsync("git", [
		"-C",
		contentRoot,
		"config",
		"user.email",
		"test@example.com",
	]);
	await execFileAsync("git", [
		"-C",
		contentRoot,
		"config",
		"user.name",
		"Test User",
	]);
	const sourceRepository = {
		listCategories: vi.fn(async () => ["tech"]),
		upsertSourceDocument: vi.fn(async () => "source-1"),
		deleteSourceByUri: vi.fn(async () => undefined),
		deleteStaleSourcesForRoot: vi.fn(async () => 0),
	};
	const wikiBlobSyncer = {
		pull: vi.fn(async () => undefined),
		push: vi.fn(async () => undefined),
	};
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set("authUser", {
			userId: "b2b2b2b2-b2b2-42b2-b2b2-b2b2b2b2b2b2",
			email: "admin@example.com",
			role: "admin",
		});
		await next();
	});
	app.route(
		"/api/sources",
		createSourcesRoute({
			contentRoot,
			sourceRepository: sourceRepository as never,
			wikiBlobSyncer: wikiBlobSyncer as never,
		}),
	);
	app.onError((error, c) =>
		c.json(
			{ message: error.message },
			("status" in error ? error.status : 500) as 400 | 403 | 500,
		),
	);
	return { app, contentRoot, sourceRepository, wikiBlobSyncer };
}

describe("Sources route authorization", () => {
	it("rejects shared-source mutations before executing repository work", async () => {
		const response = await createMemberApp().request("/sources/reindex", {
			method: "POST",
		});
		expect(response.status).toBe(403);
	});

	it("rejects option-like Git diff revisions during query validation", async () => {
		const commit = "a".repeat(40);
		const response = await createMemberApp().request(
			`/sources/diff/guide?from=${encodeURIComponent("--output=/tmp/injected")}&to=${commit}`,
		);
		expect(response.status).toBe(400);
	});
});

describe("Sources route wiki operations", () => {
	it(
		"serves health, tree, categories, search, and page CRUD",
		async () => {
		const { app, sourceRepository, wikiBlobSyncer } = await createAdminApp();
		expect((await app.request("/api/sources/health")).status).toBe(200);
		expect((await app.request("/api/sources/tree")).status).toBe(200);
		expect((await app.request("/api/sources/categories")).status).toBe(200);
		expect((await app.request("/api/sources/search")).status).toBe(200);
		expect(
			(await app.request("/api/sources/search?q=welcome")).status,
		).toBe(200);
		expect((await app.request("/api/sources/folders")).status).toBe(200);

		const created = await app.request("/api/sources/pages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				slug: "guide/setup",
				title: "Setup",
				body: "# Setup\nInstall bun.\n",
				meta: { tags: ["ops"] },
			}),
		});
		expect(created.status).toBe(200);
		expect(sourceRepository.upsertSourceDocument).toHaveBeenCalled();
		expect(
			(await app.request("/api/sources/pages", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					slug: "guide/setup",
					title: "Setup",
					body: "again",
				}),
			})).status,
		).toBe(409);
		expect((await app.request("/api/sources/pages/guide/setup")).status).toBe(
			200,
		);
		expect((await app.request("/api/sources/pages/tech/raw")).status).toBe(200);
		expect((await app.request("/api/sources/pages/missing")).status).toBe(404);
		expect((await app.request("/api/sources/history/guide/setup")).status).toBe(
			200,
		);

		const updated = await app.request("/api/sources/pages/guide/setup", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "Setup guide",
				body: "# Setup\nUpdated.\n",
			}),
		});
		expect(updated.status).toBe(200);
		const renamed = await app.request("/api/sources/pages/guide/setup", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				slug: "guide/install",
				body: "# Install\n",
			}),
		});
		expect(renamed.status).toBe(200);
		expect(sourceRepository.deleteSourceByUri).toHaveBeenCalled();

		const folder = await app.request("/api/sources/folders", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: "archive" }),
		});
		expect(folder.status).toBe(200);
		expect(
			(
				await app.request("/api/sources/folders", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path: "archive" }),
				})
			).status,
		).toBe(409);
		expect(
			(
				await app.request("/api/sources/folders/archive", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ path: "legacy" }),
				})
			).status,
		).toBe(200);
		expect(
			(await app.request("/api/sources/folders/legacy", { method: "DELETE" }))
				.status,
		).toBe(200);
		expect(
			(await app.request("/api/sources/pages/missing", { method: "DELETE" }))
				.status,
		).toBe(404);
		expect(
			(await app.request("/api/sources/pages/guide/install", {
				method: "DELETE",
			})).status,
		).toBe(200);
		expect(
			(await app.request("/api/sources/reindex", { method: "POST" })).status,
		).toBe(200);
		expect(wikiBlobSyncer.pull).toHaveBeenCalled();
		expect(wikiBlobSyncer.push).toHaveBeenCalled();
		},
		20_000,
	);
});
