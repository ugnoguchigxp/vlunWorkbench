import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import http from "node:http";
import { type Browser, chromium } from "playwright";
import { PlaywrightBrowserAdapter } from "./playwright-browser-adapter";
import type { ValidatedDastTarget } from "./types";

let server: http.Server | undefined;
let browser: Browser | undefined;
let target: ValidatedDastTarget;

beforeAll(async () => {
	server = http.createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		if (path === "/budget-page") {
			response.writeHead(200, { "content-type": "text/html" });
			return response.end('<script src="/asset"></script>');
		}
		if (path === "/asset") return response.end("asset");
		if (path === "/redirect-secret") {
			response.writeHead(302, {
				location: "/private?code=browser-secret",
			});
			return response.end();
		}
		const role = request.headers["x-test-role"];
		response.writeHead(role ? 200 : 401);
		response.end(
			role === "user-a" || role === "user-b" ? `private:${role}` : "denied",
		);
	});
	await new Promise<void>((resolve, reject) => {
		server?.once("error", reject);
		server?.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("playwright_test_server_unavailable");
	}
	const origin = `http://dast-pinned.invalid:${address.port}`;
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
	browser = await chromium.launch({
		headless: true,
		args: [
			`--host-resolver-rules=MAP dast-pinned.invalid 127.0.0.1,EXCLUDE localhost`,
		],
	});
});

afterAll(async () => {
	if (browser) {
		let closeTimer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			browser.close().catch(() => undefined),
			new Promise<void>((resolve) => {
				closeTimer = setTimeout(resolve, 3_000);
			}),
		]);
		if (closeTimer) clearTimeout(closeTimer);
	}
	await new Promise<void>((resolve) => {
		if (!server) return resolve();
		server.close(() => resolve());
	});
});

describe("PlaywrightBrowserAdapter", () => {
	it("loads the same read-only route for two encrypted identity materials", async () => {
		for (const role of ["user-a", "user-b"]) {
			const adapter = new PlaywrightBrowserAdapter(
				{
					target,
					authSecret: {
						kind: "named_header",
						name: "X-Test-Role",
						value: role,
					},
					screenshotPolicy: { enabled: false },
				},
				browser,
			);
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

	it("blocks page subrequests after the aggregate browser request budget", async () => {
		const adapter = new PlaywrightBrowserAdapter(
			{
				target: { ...target, allowedPaths: ["/"] },
				maxNetworkRequests: 1,
				screenshotPolicy: { enabled: false },
			},
			browser,
		);
		try {
			const result = await adapter.loadRoute({
				url: `${target.runnerOrigin}/budget-page`,
				path: "/budget-page",
				timeoutMs: 10_000,
			});
			expect(result.status).toBe(200);
			expect(result.requestBudgetExhausted).toBe(true);
			expect(adapter.requestCount()).toBe(1);
		} finally {
			await adapter.close();
		}
	}, 60_000);

	it("removes redirect query values from browser evidence URLs", async () => {
		const adapter = new PlaywrightBrowserAdapter(
			{
				target: { ...target, allowedPaths: ["/"], maxRequests: 5 },
				authSecret: {
					kind: "named_header",
					name: "X-Test-Role",
					value: "user-a",
				},
				maxNetworkRequests: 5,
				screenshotPolicy: { enabled: false },
			},
			browser,
		);
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
