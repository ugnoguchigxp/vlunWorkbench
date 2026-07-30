import { describe, expect, test } from "bun:test";
import type { ValidatedDastTarget } from "../dast/types";
import { authorizeZapActivePlan } from "./zap-active-policy";

const now = new Date("2026-07-30T00:00:00.000Z");
const target: ValidatedDastTarget = {
	ok: true,
	targetConfigId: "00000000-0000-4000-8000-000000000001",
	normalizedOrigin: "http://127.0.0.1:3000",
	runnerOrigin: "http://host.docker.internal:3000",
	allowedPaths: ["/api"],
	excludedPaths: [],
	defaultHeaders: {},
	maxDepth: 1,
	maxRequests: 500,
	rateLimitPerSec: 2,
	timeoutSec: 600,
	resolvedAddresses: ["127.0.0.1"],
	warnings: [],
};

function engagement(
	overrides: Record<string, unknown> = {},
): Parameters<typeof authorizeZapActivePlan>[0]["engagement"] {
	return {
		engagementId: "00000000-0000-4000-8000-000000000010",
		projectId: "00000000-0000-4000-8000-000000000020",
		status: "active",
		purpose: "internal",
		environment: "ephemeral",
		startsAt: "2026-07-29T00:00:00.000Z",
		expiresAt: "2026-07-31T00:00:00.000Z",
		scope: {
			origins: ["http://127.0.0.1:3000"],
			paths: ["/api"],
			methods: ["GET", "POST"],
		},
		rulesOfEngagement: {
			reference: "fixture",
			allowedPaths: ["/api"],
			allowedMethods: ["GET", "POST"],
			requestBudget: 500,
			rateLimitPerSec: 2,
			cleanupContract: "fixture reset",
			expiresAt: "2026-07-31T00:00:00.000Z",
			attestation: "internal fixture authorization",
		},
		...overrides,
	} as Parameters<typeof authorizeZapActivePlan>[0]["engagement"];
}

const resetStrategy = {
	kind: "container_recreate" as const,
	fixtureId: "juice-shop",
	expectedBaselineHash: `sha256:${"a".repeat(64)}`,
};

describe("ZAP active policy", () => {
	test("authorizes a bounded disposable internal plan", () => {
		expect(
			authorizeZapActivePlan({
				engagement: engagement(),
				target,
				methods: ["GET", "POST"],
				paths: ["/api/orders"],
				plannedRequests: 200,
				alreadyUsedRequests: 100,
				resetStrategy,
				featureEnabled: true,
				now,
			}),
		).toEqual({
			policyId: "zap-active-disposable-v1",
			requestBudget: 200,
			rateLimitPerSec: 2,
		});
	});

	test("rejects production, staging, public purpose, expiry, reset gaps, and flags", () => {
		const input = {
			engagement: engagement(),
			target,
			methods: ["POST"],
			paths: ["/api/orders"],
			plannedRequests: 10,
			alreadyUsedRequests: 0,
			resetStrategy,
			featureEnabled: true,
			now,
		};
		expect(() =>
			authorizeZapActivePlan({
				...input,
				engagement: engagement({ environment: "production" }),
			}),
		).toThrow("disposable");
		expect(() =>
			authorizeZapActivePlan({
				...input,
				engagement: engagement({ environment: "staging" }),
			}),
		).toThrow("disposable");
		expect(() =>
			authorizeZapActivePlan({
				...input,
				engagement: engagement({ purpose: "external" }),
			}),
		).toThrow("internal");
		expect(() =>
			authorizeZapActivePlan({ ...input, resetStrategy: null }),
		).toThrow("reset");
		expect(() =>
			authorizeZapActivePlan({ ...input, featureEnabled: false }),
		).toThrow("disabled");
	});
});
