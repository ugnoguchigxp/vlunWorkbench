import { describe, expect, it } from "vitest";
import { runBoundedHttpAssessment } from "./bounded-crawler";
import { getDastProfile } from "./profiles";
import type { ValidatedDastTarget } from "./types";

function target(overrides: Partial<ValidatedDastTarget> = {}): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "target-1",
		normalizedOrigin: "http://127.0.0.1:3000",
		runnerOrigin: "http://127.0.0.1:3000",
		allowedPaths: ["/"],
		excludedPaths: ["/excluded"],
		defaultHeaders: {},
		maxDepth: 2,
		maxRequests: 100,
		rateLimitPerSec: 1000,
		timeoutSec: 5,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
		...overrides,
	};
}

function standardProfile() {
	const profile = getDastProfile("web-passive-standard");
	if (!profile) throw new Error("missing standard DAST profile");
	return profile;
}

describe("runBoundedHttpAssessment", () => {
	it("enforces crawler depth and same-origin/path scope", async () => {
		const requested: string[] = [];
		const html: Record<string, string> = {
			"/": [
				'<a href="/depth-1">one</a>',
				'<a href="https://example.com/out">outside</a>',
				'<a href="/excluded/private">excluded</a>',
			].join(""),
			"/depth-1": '<a href="/depth-2">two</a>',
			"/depth-2": '<a href="/depth-3">three</a>',
		};
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				maxDepth: 2,
			},
			fetchImpl: async (input) => {
				const url = new URL(String(input));
				requested.push(url.pathname);
				return new Response(html[url.pathname] ?? "ok", {
					status: 200,
					headers: { "content-type": "text/html" },
				});
			},
		});

		expect(requested).toEqual(["/", "/depth-1", "/depth-2"]);
		expect(requested).not.toContain("/depth-3");
		expect(result.routeInventory).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "/excluded/private" }),
			]),
		);
		expect(result.routeInventory).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "/out" }),
			]),
		);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/depth-3",
					state: "not_tested",
					limitationCode: "max_depth_reached",
				}),
			]),
		);
	});

	it("marks required work not tested when the aggregate budget is exhausted", async () => {
		const result = await runBoundedHttpAssessment({
			target: target({ maxRequests: 1 }),
			profile: standardProfile(),
			profileConfigRoutes: ["/", "/required"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				aggregateRequestBudget: 1,
			},
			fetchImpl: async () => new Response("ok", { status: 200 }),
		});

		expect(result.requestCount).toBe(1);
		expect(result.coverage.budgetExhausted).toBe(true);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/required",
					state: "not_tested",
					limitationCode: "request_budget_exhausted",
				}),
			]),
		);
	});

	it("bounds bytes read per response", async () => {
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				maxResponseBytes: 8,
			},
			fetchImpl: async () => new Response("0123456789abcdef"),
		});

		expect(result.responses[0].bodyBytesRead).toBe(8);
		expect(result.responses[0].bodyTruncated).toBe(true);
		expect(result.coverage.responseBytesRead).toBe(8);
		expect(result.coverage.limitationCodes).toContain(
			"response_body_truncated",
		);
	});

	it("does not mark a normally completed response body as truncated", async () => {
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
			},
			fetchImpl: async () => new Response("complete"),
		});

		expect(result.responses[0].bodyBytesRead).toBe(8);
		expect(result.responses[0].bodyTruncated).toBe(false);
		expect(result.coverage.limitationCodes).not.toContain(
			"response_body_truncated",
		);
	});

	it("does not send another request after the total response budget is consumed", async () => {
		const requested: string[] = [];
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/", "/second"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				maxResponseBytes: 8,
				maxTotalResponseBytes: 8,
			},
			fetchImpl: async (input) => {
				requested.push(new URL(String(input)).pathname);
				return new Response("12345678");
			},
		});

		expect(requested).toEqual(["/"]);
		expect(result.requestCount).toBe(1);
		expect(result.coverage.budgetExhausted).toBe(true);
		expect(result.routeInventory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					path: "/second",
					state: "not_tested",
					limitationCode: "response_byte_budget_exhausted",
				}),
			]),
		);
	});

	it("does not report a configured missing route as successfully covered", async () => {
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/missing"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
			},
			fetchImpl: async () => new Response("missing", { status: 404 }),
		});

		expect(result.routeInventory).toEqual([
			expect.objectContaining({
				path: "/missing",
				state: "failed",
				limitationCode: "route_not_found",
			}),
		]);
		expect(result.coverage.successfulRouteCount).toBe(0);
		expect(result.coverage.limitationCodes).toContain("route_not_found");
	});

	it("omits configured routes with sensitive query keys instead of replaying them", async () => {
		let requestCount = 0;
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/search?access_token=secret"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
			},
			fetchImpl: async () => {
				requestCount += 1;
				return new Response("ok");
			},
		});

		expect(requestCount).toBe(0);
		expect(result.routeInventory).toEqual([
			expect.objectContaining({
				path: "/search",
				queryKeys: ["[secret-key]"],
				state: "not_tested",
				limitationCode: "sensitive_query_parameter_omitted",
			}),
		]);
		expect(result.coverage.limitationCodes).toContain(
			"sensitive_query_parameter_omitted",
		);
	});

	it("treats redirects into an excluded path as out of scope", async () => {
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/"],
			checkOptions: {
				commonPathProbes: false,
				enforceRateLimit: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
			},
			fetchImpl: async () =>
				new Response(null, {
					status: 302,
					headers: { location: "/excluded/private" },
				}),
		});

		expect(result.routeInventory).toEqual([
			expect.objectContaining({
				path: "/",
				state: "failed",
				limitationCode: "redirect_out_of_scope",
			}),
		]);
		expect(result.coverage.limitationCodes).toContain(
			"redirect_out_of_scope",
		);
	});

	it("removes redirect query values from persisted HTTP observations", async () => {
		const result = await runBoundedHttpAssessment({
			target: target(),
			profile: standardProfile(),
			profileConfigRoutes: ["/"],
			checkOptions: {
				commonPathProbes: false,
				includeApplicationModelSeeds: false,
				includeOpenApiSeeds: false,
			},
			fetchImpl: async () =>
				new Response(null, {
					status: 302,
					headers: { location: "/next?code=redirect-secret" },
				}),
		});

		expect(result.responses[0].finalUrl).not.toContain("redirect-secret");
		expect(result.responses[0].redirectChain.join(" ")).not.toContain(
			"redirect-secret",
		);
		expect(result.responses[0].headers.location).not.toContain(
			"redirect-secret",
		);
	});
});
