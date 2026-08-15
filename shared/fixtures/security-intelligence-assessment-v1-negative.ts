import {
	dependencyFindingsObservedFixture,
	dependencyNoFindingsObservedFixture,
} from "./security-intelligence-assessment-v1";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;

export type NegativeSecurityIntelligenceAssessmentFixture = {
	name: string;
	input: unknown;
	expectedIssue: string;
	validator: "contract" | "schema";
};

export const negativeSecurityIntelligenceAssessmentFixtures: readonly NegativeSecurityIntelligenceAssessmentFixture[] =
	[
		{
			name: "absolute-path-evidence",
			input: {
				...dependencyFindingsObservedFixture,
				evidenceRefs: dependencyFindingsObservedFixture.evidenceRefs.map(
					(item, index) =>
						index === 0
							? {
									...item,
									location: {
										path: "/Users/example/private/diff-manifest.json",
									},
								}
							: item,
				),
			},
			expectedIssue: "security_intelligence:repository_relative_path_required",
			validator: "schema",
		},
		{
			name: "credential-shaped-text",
			input: {
				...dependencyNoFindingsObservedFixture,
				residualRisk: ["api_key=do-not-store-this"],
			},
			expectedIssue: "security_intelligence:credential_shaped_text_forbidden",
			validator: "schema",
		},
		{
			name: "declared-producer-claim",
			input: {
				...dependencyFindingsObservedFixture,
				claims: dependencyFindingsObservedFixture.claims.map((claim) => ({
					...claim,
					origin: "declared",
				})),
			},
			expectedIssue: "security_intelligence:claim_origin_invalid",
			validator: "schema",
		},
		{
			name: "finding-not-linked-to-verification-evidence",
			input: {
				...dependencyFindingsObservedFixture,
				verifications: dependencyFindingsObservedFixture.verifications.map(
					(verification) => ({
						...verification,
						evidenceRefs: verification.evidenceRefs.filter(
							(ref) => ref !== "finding:osv:fixture",
						),
					}),
				),
			},
			expectedIssue:
				"security_intelligence:verification_finding_requires_linked_evidence",
			validator: "schema",
		},
		{
			name: "mismatched-evidence-target",
			input: {
				...dependencyFindingsObservedFixture,
				evidenceRefs: dependencyFindingsObservedFixture.evidenceRefs.map(
					(item, index) =>
						index === 0 ? { ...item, targetDigest: digest("f") } : item,
				),
			},
			expectedIssue: "security_intelligence:evidence_target_mismatch",
			validator: "schema",
		},
		{
			name: "missing-target-revision",
			input: {
				...dependencyFindingsObservedFixture,
				target: {
					...dependencyFindingsObservedFixture.target,
					sourceRevision: "",
				},
			},
			expectedIssue: "security_intelligence:revision_format_invalid",
			validator: "schema",
		},
		{
			name: "no-findings-with-required-failure",
			input: {
				...dependencyNoFindingsObservedFixture,
				verifications: dependencyNoFindingsObservedFixture.verifications.map(
					(verification) => ({ ...verification, status: "failed" }),
				),
			},
			expectedIssue:
				"security_intelligence:no_findings_requires_required_verifications_tested",
			validator: "schema",
		},
		{
			name: "semantic-assessment-ref-mismatch",
			input: {
				...dependencyNoFindingsObservedFixture,
				assessmentRef: `sia:v1:${"0".repeat(64)}`,
			},
			expectedIssue: "security_intelligence:assessment_ref_mismatch",
			validator: "contract",
		},
		{
			name: "tested-without-evidence",
			input: {
				...dependencyNoFindingsObservedFixture,
				verifications: dependencyNoFindingsObservedFixture.verifications.map(
					(verification) => ({ ...verification, evidenceRefs: [] }),
				),
			},
			expectedIssue: "security_intelligence:tested_evidence_required",
			validator: "schema",
		},
		{
			name: "unknown-field",
			input: {
				...dependencyFindingsObservedFixture,
				unexpectedVerdict: true,
			},
			expectedIssue: "security_intelligence:unknown_field",
			validator: "contract",
		},
		{
			name: "unsafe-outcome-label",
			input: {
				...dependencyNoFindingsObservedFixture,
				outcome: "safe",
			},
			expectedIssue: "security_intelligence:outcome_invalid",
			validator: "schema",
		},
	];
