import { describe, expect, it } from "bun:test";
import { authorizeRulesOfEngagement } from "./rules-of-engagement";
import type { ValidatedDastTarget } from "./types";

const target: ValidatedDastTarget = {
	ok: true,
	targetConfigId: "target",
	normalizedOrigin: "http://127.0.0.1:3000",
	runnerOrigin: "http://127.0.0.1:3000",
	allowedPaths: ["/api"],
	excludedPaths: [],
	defaultHeaders: {},
	maxDepth: 0,
	maxRequests: 20,
	rateLimitPerSec: 2,
	timeoutSec: 30,
	resolvedAddresses: ["127.0.0.1"],
	warnings: [],
};

function engagement(overrides: Record<string, unknown> = {}) {
	return {
		engagementId: "engagement",
		projectId: "project",
		status: "active",
		environment: "ephemeral" as const,
		startsAt: "2026-07-30T00:00:00.000Z",
		expiresAt: "2026-08-01T00:00:00.000Z",
		scope: {
			origins: [target.normalizedOrigin],
			paths: ["/api"],
			methods: ["POST", "DELETE"],
		},
		rulesOfEngagement: {
			reference: "ticket-1",
			allowedPaths: ["/api/fixtures"],
			allowedMethods: ["POST", "DELETE"],
			requestBudget: 10,
			rateLimitPerSec: 2,
			cleanupContract: "delete created fixtures",
			expiresAt: "2026-08-01T00:00:00.000Z",
			attestation: "owned disposable fixture",
		},
		...overrides,
	};
}

describe("authorizeRulesOfEngagement", () => {
	it("authorizes an in-scope bounded active request", () => {
		const authorized = authorizeRulesOfEngagement({
			engagement: engagement(),
			target,
			method: "POST",
			path: "/api/fixtures",
			requestCount: 2,
			now: new Date("2026-07-30T12:00:00.000Z"),
		});
		expect(authorized.remainingRequestBudget).toBe(7);
	});

	it("fails closed for production, public addresses, expiry, path, and method", () => {
		const common = {
			target,
			method: "POST",
			path: "/api/fixtures",
			requestCount: 0,
			now: new Date("2026-07-30T12:00:00.000Z"),
		};
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				engagement: engagement({ environment: "production" }),
			}),
		).toThrow("active_scan_production_rejected");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				target: { ...target, resolvedAddresses: ["8.8.8.8"] },
				engagement: engagement(),
			}),
		).toThrow("active_scan_public_target_rejected");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				now: new Date("2026-08-02T12:00:00.000Z"),
				engagement: engagement(),
			}),
		).toThrow("roe_engagement_expired");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				path: "/api/admin",
				engagement: engagement(),
			}),
		).toThrow("roe_path_not_allowed");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				method: "PATCH",
				engagement: engagement(),
			}),
		).toThrow("roe_method_not_allowed");
	});

	it("requires target origin, path, and method to remain inside engagement scope", () => {
		const common = {
			target,
			method: "POST",
			path: "/api/fixtures",
			requestCount: 0,
			now: new Date("2026-07-30T12:00:00.000Z"),
		};
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				engagement: engagement({
					scope: {
						origins: ["http://127.0.0.1:4000"],
						paths: ["/api"],
						methods: ["POST"],
					},
				}),
			}),
		).toThrow("engagement_scope_origin_not_allowed");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				engagement: engagement({
					scope: {
						origins: [target.normalizedOrigin],
						paths: ["/api/public"],
						methods: ["POST"],
					},
				}),
			}),
		).toThrow("engagement_scope_path_not_allowed");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				engagement: engagement({
					scope: {
						origins: [target.normalizedOrigin],
						paths: ["/api"],
						methods: ["DELETE"],
					},
				}),
			}),
		).toThrow("engagement_scope_method_not_allowed");
		expect(() =>
			authorizeRulesOfEngagement({
				...common,
				path: "//evil.example",
				engagement: engagement(),
			}),
		).toThrow("engagement_scope_path_not_allowed");
	});
});
