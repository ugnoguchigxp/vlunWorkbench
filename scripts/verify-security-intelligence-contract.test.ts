import { describe, expect, test } from "bun:test";
import {
	assertSecurityIntelligenceBaselineMatches,
	buildSecurityIntelligenceContractSnapshot,
	type SecurityIntelligenceStage0Baseline,
	securityIntelligenceContractSnapshotSchema,
	verifySecurityIntelligenceContract,
} from "./verify-security-intelligence-contract";

describe("Security Intelligence contract verifier", () => {
	test("matches the versioned baseline and preserves NightWorkers v1", async () => {
		const result = await verifySecurityIntelligenceContract();
		expect(result.ok).toBe(true);
		expect(result.baseline.matched).toBe(true);
		expect(result.assessmentContract.positiveFixtureCount).toBe(6);
		expect(result.assessmentContract.negativeFixtureCount).toBe(11);
		expect(result.assessmentContract.fixtureSetSha256).toMatch(
			/^sha256:[a-f0-9]{64}$/,
		);
		expect(result.nightworkersV1).toMatchObject({
			contractVersion: 1,
			unchanged: true,
		});
	});

	test("rejects internally inconsistent fixture snapshot metadata", async () => {
		const computed = await buildSecurityIntelligenceContractSnapshot();
		expect(() =>
			securityIntelligenceContractSnapshotSchema.parse({
				...computed.assessmentContract,
				negativeFixtureCount:
					computed.assessmentContract.negativeFixtureCount + 1,
			}),
		).toThrow("security_intelligence:negative_fixture_count_mismatch");
	});

	test("rejects a drifted assessment fixture baseline", async () => {
		const computed = await buildSecurityIntelligenceContractSnapshot();
		const baseline = {
			schemaVersion: 1,
			evidenceKind: "security_intelligence_stage_0_baseline",
			capturedAt: "2026-08-15T00:00:00.000Z",
			baselineCommit: "cbfdf40414cb5aee865cfa42b0b1b07f37ee9597",
			scope: "fixture",
			workingTreeContext: { excludedFromPr1: [] },
			nightworkersV1: computed.nightworkersV1,
			assessmentContract: {
				...computed.assessmentContract,
				fixtureSetSha256: `sha256:${"0".repeat(64)}` as const,
			},
			verification: {
				positiveFixtures: "pass",
				negativeFixtures: "pass",
				semanticAssessmentRefs: "pass",
				canonicalHashRepeatability: "pass",
			},
			privacy: {
				absoluteHomePathsIncluded: false,
				credentialsIncluded: false,
				sourceBodiesIncluded: false,
			},
		} satisfies SecurityIntelligenceStage0Baseline;

		expect(() =>
			assertSecurityIntelligenceBaselineMatches(computed, baseline),
		).toThrow("security_intelligence:assessment_contract_baseline_mismatch");
	});

	test("rejects incomplete privacy assertions instead of trusting a type cast", async () => {
		const computed = await buildSecurityIntelligenceContractSnapshot();
		const baseline = {
			schemaVersion: 1,
			evidenceKind: "security_intelligence_stage_0_baseline",
			capturedAt: "2026-08-15T00:00:00.000Z",
			baselineCommit: "cbfdf40414cb5aee865cfa42b0b1b07f37ee9597",
			scope: "fixture",
			workingTreeContext: { excludedFromPr1: [] },
			nightworkersV1: computed.nightworkersV1,
			assessmentContract: computed.assessmentContract,
			verification: {
				positiveFixtures: "pass",
				negativeFixtures: "pass",
				semanticAssessmentRefs: "pass",
				canonicalHashRepeatability: "pass",
			},
			privacy: {
				absoluteHomePathsIncluded: false,
				credentialsIncluded: false,
			},
		};

		expect(() =>
			assertSecurityIntelligenceBaselineMatches(computed, baseline),
		).toThrow();
	});

	test("rejects drift in the pinned NightWorkers v1 contract", async () => {
		const computed = await buildSecurityIntelligenceContractSnapshot();
		const baseline = {
			schemaVersion: 1,
			evidenceKind: "security_intelligence_stage_0_baseline",
			capturedAt: "2026-08-15T00:00:00.000Z",
			baselineCommit: "cbfdf40414cb5aee865cfa42b0b1b07f37ee9597",
			scope: "fixture",
			workingTreeContext: { excludedFromPr1: [] },
			nightworkersV1: {
				...computed.nightworkersV1,
				fixtureFileSha256: `sha256:${"0".repeat(64)}`,
			},
			assessmentContract: computed.assessmentContract,
			verification: {
				positiveFixtures: "pass",
				negativeFixtures: "pass",
				semanticAssessmentRefs: "pass",
				canonicalHashRepeatability: "pass",
			},
			privacy: {
				absoluteHomePathsIncluded: false,
				credentialsIncluded: false,
				sourceBodiesIncluded: false,
			},
		};

		expect(() =>
			assertSecurityIntelligenceBaselineMatches(computed, baseline),
		).toThrow("security_intelligence:nightworkers_v1_baseline_mismatch");
	});
});
