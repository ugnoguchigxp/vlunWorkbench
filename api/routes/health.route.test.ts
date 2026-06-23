import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createHealthRoute } from "./health.route";

describe("health route", () => {
	it("should return ok status", async () => {
		const app = new Hono().route("/health", createHealthRoute());
		const res = await app.request("/health");
		expect(res.status).toBe(200);

		const body = await res.json();
		expect(body).toEqual({
			status: "ok",
			service: "hono-standard",
		});
	});
});
