import { describe, expect, it } from "vitest";
import {
	authorizationShadowObservedFixture,
	dependencyNoFindingsObservedFixture,
} from "../fixtures/security-intelligence-assessment-v1";
import {
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
} from "../security-intelligence-assessment-contract";
import {
	deriveNightworkersSecurityIntelligenceBundleRef,
	parseNightworkersSecurityIntelligenceBundle,
} from "./nightworkers-security-intelligence.schema";
import type { SecurityIntelligenceAssessmentV1 } from "./security-intelligence-assessment.schema";

const digest = (character: string): string =>
	`sha256:${character.repeat(64)}`;
const target = {
	kind: "diff" as const,
	sourceRevision: "b".repeat(40),
	targetDigest: digest("b"),
	baseRevision: "a".repeat(40),
	headRevision: "b".repeat(40),
	baseTargetDigest: digest("a"),
};

describe("NightWorkers Security Intelligence bundle schema", () => {
	it("accepts independently versioned dependency and authorization assessments", () => {
		const semantic = bundleSemantic();
		const bundle = parseNightworkersSecurityIntelligenceBundle({
			...semantic,
			bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
		});
		expect(bundle.authorizationShadow.status).toBe("available");
		expect(bundle.bundleRef).toMatch(/^sib:v1:[a-f0-9]{64}$/);
	});

	it("rejects wrong-project assessment binding and semantic digest drift", () => {
		const semantic = bundleSemantic();
		const bundle = {
			...semantic,
			bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
		};
		expect(() =>
			parseNightworkersSecurityIntelligenceBundle({
				...bundle,
				projectRef: "project:wrong",
			}),
		).toThrow("security_intelligence:nightworkers_assessment_binding_mismatch");
		expect(() =>
			parseNightworkersSecurityIntelligenceBundle({
				...bundle,
				limitationCodes: [
					"authorization_shadow_only",
					"pilot_observation_only",
				],
			}),
		).toThrow("security_intelligence:nightworkers_bundle_digest_mismatch");
	});

	it("requires an explicit limitation when authorization shadow is disabled", () => {
		const semantic = {
			...bundleSemantic(),
			authorizationShadow: {
				status: "disabled" as const,
				reasonCode: "authorization_shadow_disabled" as const,
			},
			limitationCodes: [],
		};
		expect(() =>
			parseNightworkersSecurityIntelligenceBundle({
				...semantic,
				bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
			}),
		).toThrow(
			"security_intelligence:nightworkers_authorization_state_limitation_required",
		);
	});
});

function bundleSemantic() {
	return {
		contractVersion: 1 as const,
		projectRef: "project:fixture",
		scanRunRef: "scan-run:fixture",
		target,
		dependencyAssessment: rebind(dependencyNoFindingsObservedFixture),
		authorizationShadow: {
			status: "available" as const,
			assessment: rebind(authorizationShadowObservedFixture),
		},
		limitationCodes: ["authorization_shadow_only"],
	};
}

function rebind(
	input: SecurityIntelligenceAssessmentV1,
): SecurityIntelligenceAssessmentV1 {
	const assessment = structuredClone(input);
	assessment.projectRef = "project:fixture";
	assessment.source.scanRunRef = "scan-run:fixture";
	assessment.target = target;
	assessment.evidenceRefs = assessment.evidenceRefs.map((evidence) => ({
		...evidence,
		scanRunRef: assessment.source.scanRunRef,
		targetDigest:
			evidence.targetRole === "base_target"
				? target.baseTargetDigest
				: target.targetDigest,
	}));
	assessment.assessmentRef = deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}
