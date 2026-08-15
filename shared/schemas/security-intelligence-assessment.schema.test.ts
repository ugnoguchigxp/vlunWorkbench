import { describe, expect, it } from "vitest";
import {
	authorizationShadowObservedFixture,
	dependencyFindingsObservedFixture,
	dependencyNoFindingsObservedFixture,
	dependencyUnavailableFixture,
	positiveSecurityIntelligenceAssessmentFixtures,
} from "../fixtures/security-intelligence-assessment-v1";
import { negativeSecurityIntelligenceAssessmentFixtures } from "../fixtures/security-intelligence-assessment-v1-negative";
import {
	canonicalStringifySecurityIntelligenceValue,
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
	securityIntelligenceAssessmentSemanticCanonicalJson,
} from "../security-intelligence-assessment-contract";
import {
	securityIntelligenceAssessmentV1Schema,
	securityIntelligenceRepositoryPathSchema,
} from "./security-intelligence-assessment.schema";

describe("Security Intelligence Assessment v1 schema", () => {
	it("parses every canonical positive fixture", () => {
		for (const fixture of Object.values(
			positiveSecurityIntelligenceAssessmentFixtures,
		)) {
			expect(securityIntelligenceAssessmentV1Schema.parse(fixture)).toEqual(
				fixture,
			);
		}
	});

	it("derives every assessment ref from the semantic canonical payload", () => {
		for (const fixture of Object.values(
			positiveSecurityIntelligenceAssessmentFixtures,
		)) {
			const assessment = securityIntelligenceAssessmentV1Schema.parse(fixture);
			expect(assessment.assessmentRef).toBe(
				deriveSecurityIntelligenceAssessmentRef(assessment),
			);
		}
	});

	it("rejects every canonical negative fixture for its expected issue", () => {
		for (const fixture of negativeSecurityIntelligenceAssessmentFixtures) {
			if (fixture.validator === "contract") {
				expect(
					() => parseSecurityIntelligenceAssessmentV1(fixture.input),
					fixture.name,
				).toThrow(fixture.expectedIssue);
				continue;
			}
			const result = securityIntelligenceAssessmentV1Schema.safeParse(
				fixture.input,
			);
			expect(result.success, fixture.name).toBe(false);
			if (result.success) continue;
			expect(
				result.error.issues.some(
					(issue) =>
						issue.code === fixture.expectedIssue ||
						issue.message === fixture.expectedIssue,
				),
				`${fixture.name}: ${JSON.stringify(result.error.issues)}`,
			).toBe(true);
		}
	});

	it("does not let generatedAt change the semantic identity", () => {
		const original = securityIntelligenceAssessmentV1Schema.parse(
			dependencyNoFindingsObservedFixture,
		);
		const regenerated = securityIntelligenceAssessmentV1Schema.parse({
			...dependencyNoFindingsObservedFixture,
			generatedAt: "2026-08-16T01:02:00.000Z",
		});
		expect(
			securityIntelligenceAssessmentSemanticCanonicalJson(regenerated),
		).toBe(securityIntelligenceAssessmentSemanticCanonicalJson(original));
	});

	it("canonicalizes object keys without reordering arrays", () => {
		expect(
			canonicalStringifySecurityIntelligenceValue({
				z: ["second", "first"],
				a: { y: 2, x: 1 },
			}),
		).toBe('{"a":{"x":1,"y":2},"z":["second","first"]}');
		expect(
			canonicalStringifySecurityIntelligenceValue(
				JSON.parse('{"__proto__":{"preserved":true}}'),
			),
		).toBe('{"__proto__":{"preserved":true}}');
	});

	it("rejects values that JSON would silently coerce", () => {
		expect(() =>
			canonicalStringifySecurityIntelligenceValue(new Date()),
		).toThrow("security_intelligence:canonical_plain_object_required");
		expect(() =>
			canonicalStringifySecurityIntelligenceValue(new Array(1)),
		).toThrow(
			"security_intelligence:canonical_sparse_or_extended_array_not_supported",
		);
		expect(() =>
			canonicalStringifySecurityIntelligenceValue({ value: undefined }),
		).toThrow("security_intelligence:canonical_undefined_not_supported");
		const extendedArray = ["value"];
		Object.defineProperty(extendedArray, "metadata", { value: "ignored" });
		expect(() =>
			canonicalStringifySecurityIntelligenceValue(extendedArray),
		).toThrow(
			"security_intelligence:canonical_sparse_or_extended_array_not_supported",
		);
		const accessor = {};
		Object.defineProperty(accessor, "value", {
			enumerable: true,
			get: () => "computed",
		});
		expect(() =>
			canonicalStringifySecurityIntelligenceValue(accessor),
		).toThrow("security_intelligence:canonical_plain_object_property_required");
		expect(() =>
			canonicalStringifySecurityIntelligenceValue("e\u0301"),
		).toThrow("security_intelligence:canonical_unicode_must_be_nfc");
		expect(() =>
			canonicalStringifySecurityIntelligenceValue({ ["e\u0301"]: "value" }),
		).toThrow("security_intelligence:canonical_unicode_must_be_nfc");
	});

	it("requires all references to resolve to target-bound evidence", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyFindingsObservedFixture,
				claims: dependencyFindingsObservedFixture.claims.map((claim) => ({
					...claim,
					evidenceRefs: ["artifact:missing"],
				})),
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				target: {
					...dependencyNoFindingsObservedFixture.target,
					sourceRevision: "refs//heads/main",
				},
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				target: {
					...dependencyNoFindingsObservedFixture.target,
					sourceRevision: "https://example.invalid/revision",
				},
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...authorizationShadowObservedFixture,
				target: {
					...authorizationShadowObservedFixture.target,
					baseTargetDigest: undefined,
				},
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...authorizationShadowObservedFixture,
				target: {
					...authorizationShadowObservedFixture.target,
					sourceRevision: "c".repeat(40),
				},
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				residualRisk: ['"apiKey":"do-not-store-this"'],
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				residualRisk: ["Analyzer read /tmp/private-project/source.ts"],
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				residualRisk: ["Analyzer read /workspace/private-project/source.ts"],
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				residualRisk: ["Cafe\u0301 risk remains"],
			}).success,
		).toBe(false);
	});

	it("rejects non-canonical set ordering", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				coverage: {
					...dependencyNoFindingsObservedFixture.coverage,
					covered: [
						...dependencyNoFindingsObservedFixture.coverage.covered,
					].reverse(),
				},
			}).success,
		).toBe(false);
	});

	it("accepts only normalized repository-relative evidence paths", () => {
		expect(
			securityIntelligenceRepositoryPathSchema.parse("api/routes/admin.ts"),
		).toBe("api/routes/admin.ts");
		expect(
			securityIntelligenceRepositoryPathSchema.safeParse("../admin.ts").success,
		).toBe(false);
	});

	it("rejects non-canonical identifiers, timestamps, and control text", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				projectRef: " project:fixture ",
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				generatedAt: "2026-08-15T01:02:00Z",
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				residualRisk: ["First line\nSecond line"],
			}).success,
		).toBe(false);
	});

	it("requires each finding ref to resolve to finding evidence", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyFindingsObservedFixture,
				evidenceRefs: dependencyFindingsObservedFixture.evidenceRefs.map(
					(evidence) =>
						evidence.kind === "finding"
							? { ...evidence, kind: "report" }
							: evidence,
				),
			}).success,
		).toBe(false);
	});

	it("requires source-location evidence to include a normalized location", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				evidenceRefs: dependencyNoFindingsObservedFixture.evidenceRefs.map(
					(evidence, index) =>
						index === 0 ? { ...evidence, kind: "source_location" } : evidence,
				),
			}).success,
		).toBe(false);
	});

	it("keeps outcome and source completion semantics consistent", () => {
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyFindingsObservedFixture,
				outcome: "inconclusive",
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyNoFindingsObservedFixture,
				generatedAt: "2026-08-15T00:00:00.000Z",
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyUnavailableFixture,
				verifications: dependencyUnavailableFixture.verifications.map(
					(verification) => ({ ...verification, status: "tested" }),
				),
			}).success,
		).toBe(false);
		expect(
			securityIntelligenceAssessmentV1Schema.safeParse({
				...dependencyUnavailableFixture,
				coverage: { covered: [], gaps: [], limitationCodes: [] },
				unknowns: [],
			}).success,
		).toBe(false);
	});
});
