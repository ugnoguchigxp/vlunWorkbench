import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PlaywrightBrowserAdapter } from "./playwright-browser-adapter";
import type { ValidatedDastTarget } from "./types";

let server: ReturnType<typeof Bun.serve>;
let target: ValidatedDastTarget;

beforeAll(() => {
		server = Bun.serve({
			port: 0,
			fetch(request) {
				const path = new URL(request.url).pathname;
				if (path === "/budget-page") {
					return new Response('<script src="/asset"></script>', {
						headers: { "content-type": "text/html" },
					});
				}
				if (path === "/asset") return new Response("asset");
				if (path === "/redirect-secret") {
					return new Response(null, {
						status: 302,
						headers: { location: "/private?code=browser-secret" },
					});
				}
				const role = request.headers.get("x-test-role");
			return new Response(
				role === "user-a" || role === "user-b" ? `private:${role}` : "denied",
				{ status: role ? 200 : 401 },
			);
		},
	});
	const origin = `http://dast-pinned.invalid:${server.port}`;
	target = {
		ok: true,
		targetConfigId: "target",
		normalizedOrigin: origin,
		runnerOrigin: origin,
		allowedPaths: ["/private"],
		excludedPaths: [],
		defaultHeaders: {},
		maxDepth: 0,
		maxRequests: 2,
		rateLimitPerSec: 2,
		timeoutSec: 10,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
});

afterAll(() => server.stop(true));

describe("PlaywrightBrowserAdapter", () => {
	it("loads the same read-only route for two encrypted identity materials", async () => {
		for (const role of ["user-a", "user-b"]) {
			const adapter = new PlaywrightBrowserAdapter({
				target,
				authSecret: {
					kind: "named_header",
					name: "X-Test-Role",
					value: role,
				},
				screenshotPolicy: { enabled: false },
			});
			try {
				const result = await adapter.loadRoute({
					url: `${target.runnerOrigin}/private`,
					path: "/private",
					timeoutMs: 10_000,
				});
				expect(result.status).toBe(200);
				expect(result.screenshot).toBeUndefined();
			} finally {
				await adapter.close();
			}
		}
	}, 60_000);

	it("aborts page subrequests after the aggregate browser request budget", async () => {
		const adapter = new PlaywrightBrowserAdapter({
			target: { ...target, allowedPaths: ["/"] },
			maxNetworkRequests: 1,
			screenshotPolicy: { enabled: false },
		});
		try {
			const result = await adapter.loadRoute({
				url: `${target.runnerOrigin}/budget-page`,
				path: "/budget-page",
				timeoutMs: 10_000,
			});
			expect(result.status).toBe(200);
			expect(result.requestBudgetExhausted).toBe(true);
		} finally {
			await adapter.close();
		}
	}, 60_000);

	it("removes redirect query values from browser evidence URLs", async () => {
		const adapter = new PlaywrightBrowserAdapter({
			target: { ...target, allowedPaths: ["/"], maxRequests: 5 },
			authSecret: {
				kind: "named_header",
				name: "X-Test-Role",
				value: "user-a",
			},
			maxNetworkRequests: 5,
			screenshotPolicy: { enabled: false },
		});
		try {
			const result = await adapter.loadRoute({
				url: `${target.runnerOrigin}/redirect-secret`,
				path: "/redirect-secret",
				timeoutMs: 10_000,
			});
			expect(result.status).toBe(200);
			expect(result.finalUrl).toContain("code=");
			expect(result.finalUrl).not.toContain("browser-secret");
		} finally {
			await adapter.close();
		}
	}, 60_000);
});
