import { readFileSync } from "node:fs";
import path from "node:path";
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
	nightworkersSecurityIntelligenceSuccessEnvelopeSchema,
	parseNightworkersSecurityIntelligenceBundle,
} from "./nightworkers-security-intelligence.schema";
import type { SecurityIntelligenceAssessmentV1 } from "./security-intelligence-assessment.schema";

const digest = (character: string): string =>
	`sha256:${character.repeat(64)}`;
const dependencyTarget = {
	kind: "diff" as const,
	sourceRevision: "b".repeat(40),
	targetDigest: digest("b"),
};
const authorizationTarget = {
	...dependencyTarget,
	baseRevision: "a".repeat(40),
	headRevision: "b".repeat(40),
	baseTargetDigest: digest("a"),
};

describe("NightWorkers Security Intelligence bundle schema", () => {
	it("parses the checked-in cross-repository response fixture", () => {
		const fixture = nightworkersSecurityIntelligenceSuccessEnvelopeSchema.parse(
			JSON.parse(
				readFileSync(
					path.resolve(
						process.cwd(),
						"shared/fixtures/nightworkers-security-intelligence-v1.json",
					),
					"utf8",
				),
			),
		);
		expect(
			parseNightworkersSecurityIntelligenceBundle(fixture.data).bundleRef,
		).toBe(fixture.data.bundleRef);
	});

	it("accepts independently versioned dependency and authorization assessments", () => {
		const semantic = bundleSemantic();
		const bundle = parseNightworkersSecurityIntelligenceBundle({
			...semantic,
			bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
		});
		expect(bundle.authorizationShadow.status).toBe("available");
		expect(bundle.bundleRef).toMatch(/^sib:v1:[a-f0-9]{64}$/);
		expect(bundle.dependencyAssessment.target.baseRevision).toBeUndefined();
		if (bundle.authorizationShadow.status === "available") {
			expect(bundle.authorizationShadow.assessment.target.baseRevision).toBe(
				"a".repeat(40),
			);
		}
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
			"security_intelligence:nightworkers_authorization_state_limitation_mismatch",
		);
	});

	it("rejects contradictory authorization state limitations", () => {
		const semantic = {
			...bundleSemantic(),
			authorizationShadow: {
				status: "disabled" as const,
				reasonCode: "authorization_shadow_disabled" as const,
			},
			limitationCodes: [
				"authorization_shadow_disabled",
				"authorization_shadow_unavailable",
			],
		};
		expect(() => parseBundleSemantic(semantic)).toThrow(
			"security_intelligence:nightworkers_authorization_state_limitation_mismatch",
		);
	});

	it("rejects authorization assessments that drift from shared target identity", () => {
		const assessment = rebind(
			authorizationShadowObservedFixture,
			{
				...authorizationTarget,
				targetDigest: digest("c"),
			},
		);
		const semantic = {
			...bundleSemantic(),
			authorizationShadow: { status: "available" as const, assessment },
		};

		expect(() => parseBundleSemantic(semantic)).toThrow(
			"security_intelligence:nightworkers_assessment_binding_mismatch",
		);
	});

	it("rejects assessments from the wrong security intelligence domain", () => {
		const dependencyAsAuthorization = rebind(
			dependencyNoFindingsObservedFixture,
			authorizationTarget,
		);
		const authorizationAsDependency = rebind(
			dependencyNoFindingsObservedFixture,
			dependencyTarget,
		);
		authorizationAsDependency.verifications =
			authorizationAsDependency.verifications.map((verification) => ({
				...verification,
				capabilityRef: "authorization-boundary:fixture",
			}));
		authorizationAsDependency.assessmentRef =
			deriveSecurityIntelligenceAssessmentRef(authorizationAsDependency);

		expect(() =>
			parseBundleSemantic({
				...bundleSemantic(),
				dependencyAssessment: authorizationAsDependency,
			}),
		).toThrow(
			"security_intelligence:nightworkers_dependency_assessment_required",
		);
		expect(() =>
			parseBundleSemantic({
				...bundleSemantic(),
				authorizationShadow: {
					status: "available" as const,
					assessment: dependencyAsAuthorization,
				},
			}),
		).toThrow(
			"security_intelligence:nightworkers_authorization_assessment_required",
		);
	});
});

function bundleSemantic() {
	return {
		contractVersion: 1 as const,
		projectRef: "project:fixture",
		scanRunRef: "scan-run:fixture",
		target: dependencyTarget,
		dependencyAssessment: rebind(
			dependencyNoFindingsObservedFixture,
			dependencyTarget,
		),
		authorizationShadow: {
			status: "available" as const,
			assessment: rebind(
				authorizationShadowObservedFixture,
				authorizationTarget,
			),
		},
		limitationCodes: ["authorization_shadow_only"],
	};
}

function rebind(
	input: SecurityIntelligenceAssessmentV1,
	selectedTarget: SecurityIntelligenceAssessmentV1["target"],
): SecurityIntelligenceAssessmentV1 {
	const assessment = structuredClone(input);
	assessment.projectRef = "project:fixture";
	assessment.source.scanRunRef = "scan-run:fixture";
	assessment.target = selectedTarget;
	assessment.evidenceRefs = assessment.evidenceRefs.map((evidence) => ({
		...evidence,
		scanRunRef: assessment.source.scanRunRef,
		targetDigest:
			evidence.targetRole === "base_target"
				? (selectedTarget.baseTargetDigest ?? selectedTarget.targetDigest)
				: selectedTarget.targetDigest,
	}));
	assessment.assessmentRef = deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}

function parseBundleSemantic(
	semantic: Parameters<
		typeof deriveNightworkersSecurityIntelligenceBundleRef
	>[0],
) {
	return parseNightworkersSecurityIntelligenceBundle({
		...semantic,
		bundleRef: deriveNightworkersSecurityIntelligenceBundleRef(semantic),
	});
}
