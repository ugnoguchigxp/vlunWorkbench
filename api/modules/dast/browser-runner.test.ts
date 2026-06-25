import { describe, expect, it } from "vitest";
import { MockBrowserAdapter, runBrowserSmoke } from "./browser-runner";
import { getDastProfile } from "./profiles";
import type { ValidatedDastTarget } from "./types";

function target(): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "target-1",
		normalizedOrigin: "http://127.0.0.1:3000",
		runnerOrigin: "http://127.0.0.1:3000",
		allowedPaths: ["/app"],
		excludedPaths: [],
		defaultHeaders: {},
		maxDepth: 0,
		maxRequests: 10,
		rateLimitPerSec: 2,
		timeoutSec: 5,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
}

describe("runBrowserSmoke", () => {
	it("loads only configured in-scope routes with mocked browser adapter", async () => {
		const profile = getDastProfile("browser-smoke");
		if (!profile) throw new Error("missing profile");
		const result = await runBrowserSmoke({
			target: target(),
			profile,
			profileConfigRoutes: ["/app", "/admin"],
			adapter: new MockBrowserAdapter({
				"/app": { consoleErrors: ["boom"] },
			}),
		});
		expect(result.routes).toHaveLength(1);
		expect(result.routes[0].path).toBe("/app");
		expect(result.routes[0].consoleErrors).toEqual(["boom"]);
		expect(result.routes[0].screenshot?.bytes.length).toBeGreaterThan(0);
	});
});
