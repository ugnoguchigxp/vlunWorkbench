import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createSourcesRoute } from "./sources.route";

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

describe("Sources route authorization", () => {
	it("rejects shared-source mutations before executing repository work", async () => {
		const response = await createMemberApp().request("/sources/reindex", {
			method: "POST",
		});
		expect(response.status).toBe(403);
	});
});
