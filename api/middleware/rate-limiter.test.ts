import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimiter } from "./rate-limiter";

const buildApp = (trustProxy: boolean) => {
	const app = new Hono();
	app.use(
		"/limited",
		rateLimiter({
			windowMs: 60 * 1000,
			limit: 1,
			trustProxy,
		}),
	);
	app.get("/limited", (c) => c.json({ ok: true }));
	return app;
};

describe("rateLimiter", () => {
	it("ignores spoofed proxy headers when trustProxy is false", async () => {
		const app = buildApp(false);
		const first = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "1.1.1.1" },
		});
		const second = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "2.2.2.2" },
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
	});

	it("uses proxy headers when trustProxy is true", async () => {
		const app = buildApp(true);
		const first = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "1.1.1.1" },
		});
		const second = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "2.2.2.2" },
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
	});
});
