import { describe, expect, it } from "vitest";
import { runHttpBaseline } from "./http-runner";
import { getDastProfile } from "./profiles";
import type { ValidatedDastTarget } from "./types";

function target(): ValidatedDastTarget {
	return {
		ok: true,
		targetConfigId: "target-1",
		normalizedOrigin: "http://127.0.0.1:3000",
		runnerOrigin: "http://127.0.0.1:3000",
		allowedPaths: ["/"],
		excludedPaths: [],
		defaultHeaders: {},
		maxDepth: 0,
		maxRequests: 5,
		rateLimitPerSec: 1000,
		timeoutSec: 1,
		resolvedAddresses: ["127.0.0.1"],
		warnings: [],
	};
}

describe("runHttpBaseline", () => {
	it("captures selected response metadata with mocked fetch", async () => {
		const profile = getDastProfile("http-baseline");
		if (!profile) throw new Error("missing profile");
		const result = await runHttpBaseline({
			target: target(),
			profile,
			profileConfigRoutes: ["/health"],
			checkOptions: { commonPathProbes: false },
			fetchImpl: async () =>
				new Response("ok", {
					status: 200,
					headers: {
						"content-security-policy": "default-src 'self'",
						"x-frame-options": "DENY",
						"x-content-type-options": "nosniff",
						"set-cookie": "sid=secret; Path=/; HttpOnly",
					},
				}),
		});
		expect(result.requestCount).toBe(1);
		expect(result.responses[0].headers["set-cookie"]).toBe("[redacted-cookie-value]");
		expect(result.responses[0].setCookies[0].name).toBe("sid");
	});

	it("cancels response bodies after collecting bounded metadata", async () => {
		const profile = getDastProfile("http-baseline");
		if (!profile) throw new Error("missing profile");
		let cancelled = false;
		await runHttpBaseline({
			target: target(),
			profile,
			profileConfigRoutes: ["/health"],
			checkOptions: { commonPathProbes: false },
			fetchImpl: async () =>
				new Response(
					new ReadableStream({
						cancel() {
							cancelled = true;
						},
					}),
					{ status: 200 },
				),
		});
		expect(cancelled).toBe(true);
	});
});
