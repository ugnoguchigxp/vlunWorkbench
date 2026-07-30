import { describe, expect, it } from "vitest";
import {
	createAssessmentEngagementSchema,
	scanCoverageResultSchema,
} from "./assessment.schema";

describe("assessment schemas", () => {
	const base = {
		projectId: "11111111-1111-4111-8111-111111111111",
		purpose: "internal" as const,
		environment: "local" as const,
		scope: { origins: [], paths: ["/"], methods: ["GET" as const] },
		rulesOfEngagement: null,
		startsAt: "2026-07-30T00:00:00.000Z",
		expiresAt: "2026-07-31T00:00:00.000Z",
	};

	it("accepts a bounded read-only engagement", () => {
		expect(createAssessmentEngagementSchema.parse(base).scope.methods).toEqual([
			"GET",
		]);
	});

	it("rejects active methods for production engagements", () => {
		const result = createAssessmentEngagementSchema.safeParse({
			...base,
			environment: "production",
			rulesOfEngagement: {
				reference: "approved-ticket",
				allowedPaths: ["/api"],
				allowedMethods: ["POST"],
				requestBudget: 10,
				rateLimitPerSec: 1,
				cleanupContract: "Delete seeded records.",
				expiresAt: base.expiresAt,
				attestation: "Authorized by the service owner.",
			},
		});
		expect(result.success).toBe(false);
	});

	it("keeps rules of engagement within canonical scope and lifetime", () => {
		const roe = {
			reference: "approved-ticket",
			allowedPaths: ["/api"],
			allowedMethods: ["POST"],
			requestBudget: 10,
			rateLimitPerSec: 1,
			cleanupContract: "Delete seeded records.",
			expiresAt: base.expiresAt,
			attestation: "Owned disposable fixture.",
		};
		expect(
			createAssessmentEngagementSchema.safeParse({
				...base,
				scope: {
					origins: ["http://127.0.0.1:3000"],
					paths: ["/api"],
					methods: ["POST"],
				},
				rulesOfEngagement: roe,
			}).success,
		).toBe(true);
		expect(
			createAssessmentEngagementSchema.safeParse({
				...base,
				scope: {
					origins: ["http://127.0.0.1:3000/path"],
					paths: ["//evil.example"],
					methods: ["GET"],
				},
			}).success,
		).toBe(false);
		expect(
			createAssessmentEngagementSchema.safeParse({
				...base,
				scope: {
					origins: ["http://127.0.0.1:3000"],
					paths: ["/api"],
					methods: ["GET"],
				},
				rulesOfEngagement: roe,
			}).success,
		).toBe(false);
		expect(
			createAssessmentEngagementSchema.safeParse({
				...base,
				scope: {
					origins: ["http://127.0.0.1:3000"],
					paths: ["/api"],
					methods: ["POST"],
				},
				rulesOfEngagement: {
					...roe,
					expiresAt: "2026-08-01T00:00:00.000Z",
				},
			}).success,
		).toBe(false);
	});

	it("does not allow tested coverage without evidence", () => {
		const result = scanCoverageResultSchema.safeParse({
			controlId: "API1:2023",
			status: "tested_passed",
			method: "automated",
			reasonCode: "completed_without_finding",
			evidenceRefs: [],
		});
		expect(result.success).toBe(false);
	});
});
