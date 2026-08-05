import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createProtectedRoute } from "./protected.route";

describe("protected route", () => {
	it("returns the authenticated profile from context", async () => {
		const app = new Hono();
		app.use("/protected/*", async (c, next) => {
			c.set("authUser", {
				userId: "a1a1a1a1-a1a1-41a1-a1a1-a1a1a1a1a1a1",
				email: "test@example.com",
				role: "member",
			});
			await next();
		});
		app.route("/protected", createProtectedRoute());

		const res = await app.request("/protected/profile");
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.profile).toEqual({
			email: "test@example.com",
			role: "member",
		});
	});
});
