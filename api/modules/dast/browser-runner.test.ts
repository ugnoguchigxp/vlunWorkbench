import { describe, expect, it, vi } from "vitest";
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

	it("adds bounded same-origin browser network routes to the inventory", async () => {
		const profile = getDastProfile("authenticated-readonly-standard");
		if (!profile) throw new Error("missing profile");
		const assessedTarget = { ...target(), maxDepth: 1 };
		const result = await runBrowserSmoke({
			target: assessedTarget,
			profile,
			profileConfigRoutes: ["/app"],
			adapter: new MockBrowserAdapter({
				"/app": {
					networkRequests: [
						{
							path: "/app/api/items",
							queryKeys: ["page"],
							method: "GET",
							status: 200,
						},
						{
							path: "/app/api/mutate",
							queryKeys: [],
							method: "POST",
							status: 201,
						},
					],
				},
			}),
		});

		expect(result.routes.map((route) => route.path)).toEqual(["/app"]);
		expect(result.coverage.requestCount).toBe(1);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/app/api/items",
					sources: ["browser_network"],
					state: "succeeded",
				}),
			]),
		);
		expect(
			result.routeInventory.some(
				(entry) => entry.path === "/app/api/mutate",
			),
		).toBe(false);
		expect(result.routes[0].networkRequests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/app/api/mutate",
					method: "POST",
				}),
			]),
		);
	});

	it("marks remaining authenticated routes not tested after session denial", async () => {
		const profile = getDastProfile("authenticated-readonly-standard");
		if (!profile) throw new Error("missing profile");
		const result = await runBrowserSmoke({
			target: { ...target(), allowedPaths: ["/"], maxDepth: 1 },
			profile,
			profileConfigRoutes: ["/app", "/protected"],
			adapter: new MockBrowserAdapter({
				"/app": { status: 401 },
			}),
		});

		expect(result.routes).toHaveLength(1);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/app",
					state: "denied_unexpected",
					limitationCode: "authentication_failed",
				}),
				expect.objectContaining({
					path: "/protected",
					state: "not_tested",
					limitationCode: "session_expired",
				}),
			]),
		);
	});

	it("marks missing and server-error routes as failed", async () => {
		const profile = getDastProfile("browser-smoke");
		if (!profile) throw new Error("missing profile");
		const result = await runBrowserSmoke({
			target: { ...target(), allowedPaths: ["/"] },
			profile,
			profileConfigRoutes: ["/missing", "/broken"],
			adapter: new MockBrowserAdapter({
				"/missing": { status: 404 },
				"/broken": { status: 503 },
			}),
		});

		expect(result.coverage.successfulRouteCount).toBe(0);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/missing",
					state: "failed",
					limitationCode: "route_not_found",
				}),
				expect.objectContaining({
					path: "/broken",
					state: "failed",
					limitationCode: "server_error",
				}),
			]),
		);
	});

	it("stops after the adapter reports an exhausted network request budget", async () => {
		const profile = getDastProfile("browser-smoke");
		if (!profile) throw new Error("missing profile");
		const result = await runBrowserSmoke({
			target: { ...target(), allowedPaths: ["/"] },
			profile,
			profileConfigRoutes: ["/app", "/later"],
			adapter: new MockBrowserAdapter({
				"/app": { requestBudgetExhausted: true },
			}),
		});

		expect(result.routes).toHaveLength(1);
		expect(result.coverage.budgetExhausted).toBe(true);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/app",
					limitationCode: "request_budget_exhausted",
				}),
				expect.objectContaining({
					path: "/later",
					state: "not_tested",
					limitationCode: "request_budget_exhausted",
				}),
			]),
		);
	});

	it("keeps configured routes visible when the top-level request budget is lower", async () => {
		const profile = getDastProfile("browser-smoke");
		if (!profile) throw new Error("missing profile");
		const result = await runBrowserSmoke({
			target: { ...target(), allowedPaths: ["/"] },
			profile,
			profileConfigRoutes: ["/first", "/second"],
			maxRequests: 1,
			adapter: new MockBrowserAdapter(),
		});

		expect(result.routes).toHaveLength(1);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/second",
					state: "not_tested",
					limitationCode: "request_budget_exhausted",
				}),
			]),
		);
	});

	it("marks pending routes not tested when the aggregate browser deadline is reached", async () => {
		const profile = getDastProfile("browser-smoke");
		if (!profile) throw new Error("missing profile");
		const now = vi
			.spyOn(Date, "now")
			.mockReturnValueOnce(0)
			.mockReturnValue(1_001);
		try {
			const result = await runBrowserSmoke({
				target: target(),
				profile,
				profileConfigRoutes: ["/app"],
				totalTimeoutSec: 1,
				adapter: new MockBrowserAdapter(),
			});

			expect(result.routes).toHaveLength(0);
			expect(result.routeInventory).toEqual([
				expect.objectContaining({
					path: "/app",
					state: "not_tested",
					limitationCode: "assessment_timeout",
				}),
			]);
		} finally {
			now.mockRestore();
		}
	});
});
