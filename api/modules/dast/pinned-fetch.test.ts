import { describe, expect, it } from "bun:test";
import { pinnedDastFetch } from "./pinned-fetch";
import type { ValidatedDastTarget } from "./types";

describe("pinnedDastFetch", () => {
	it("connects to the validated address without resolving the configured hostname", async () => {
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				return Response.json({
					host: request.headers.get("host"),
				});
			},
		});
		try {
			const target: ValidatedDastTarget = {
				ok: true,
				targetConfigId: "target",
				normalizedOrigin: `http://unresolvable.invalid:${server.port}`,
				runnerOrigin: `http://unresolvable.invalid:${server.port}`,
				allowedPaths: ["/"],
				excludedPaths: [],
				defaultHeaders: {},
				maxDepth: 0,
				maxRequests: 1,
				rateLimitPerSec: 1,
				timeoutSec: 1,
				resolvedAddresses: ["127.0.0.1"],
				warnings: [],
			};
			const response = await pinnedDastFetch(
				target,
				`${target.runnerOrigin}/health`,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"application/json",
			);
			expect(await response.json()).toEqual({
				host: `unresolvable.invalid:${server.port}`,
			});
		} finally {
			server.stop(true);
		}
	});

	it("rejects an origin that was not validated", async () => {
		const target = {
			ok: true as const,
			targetConfigId: "target",
			normalizedOrigin: "http://internal.invalid",
			runnerOrigin: "http://internal.invalid",
			allowedPaths: ["/"],
			excludedPaths: [],
			defaultHeaders: {},
			maxDepth: 0,
			maxRequests: 1,
			rateLimitPerSec: 1,
			timeoutSec: 1,
			resolvedAddresses: ["127.0.0.1"],
			warnings: [],
		};
		await expect(
			pinnedDastFetch(target, "http://other.invalid/"),
		).rejects.toThrow("pinned_fetch_origin_mismatch");
	});
});
