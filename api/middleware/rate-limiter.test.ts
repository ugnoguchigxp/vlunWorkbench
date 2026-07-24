import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimiter } from "./rate-limiter";

const buildApp = (
	trustProxy: boolean,
	trustedProxyCidrs: string[] = [],
	directIp = "203.0.113.10",
) => {
	const app = new Hono();
	app.use(
		"/limited",
		rateLimiter({
			windowMs: 60 * 1000,
			limit: 1,
			trustProxy,
			trustedProxyCidrs,
			remoteAddressResolver: () => directIp,
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

	it("uses proxy headers only when the direct peer is trusted", async () => {
		const app = buildApp(true, ["203.0.113.0/24"]);
		const first = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "1.1.1.1" },
		});
		const second = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "2.2.2.2" },
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
	});

	it("ignores proxy headers from an untrusted direct peer", async () => {
		const app = buildApp(true, ["10.0.0.0/8"]);
		const first = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "1.1.1.1" },
		});
		const second = await app.request("http://localhost/limited", {
			headers: { "x-forwarded-for": "2.2.2.2" },
		});
		expect(first.status).toBe(200);
		expect(second.status).toBe(429);
		expect(second.headers.get("retry-after")).toBeTruthy();
	});
});
