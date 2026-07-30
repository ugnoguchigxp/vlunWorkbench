import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PlaywrightBrowserAdapter } from "./playwright-browser-adapter";
import type { ValidatedDastTarget } from "./types";

let server: ReturnType<typeof Bun.serve>;
let target: ValidatedDastTarget;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(request) {
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
	}, 30_000);
});
