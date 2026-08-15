import type { SecurityIntelligenceAssessmentV1 } from "../schemas/security-intelligence-assessment.schema";
import { SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION } from "../schemas/security-intelligence-assessment.schema";

const digest = (character: string): string => `sha256:${character.repeat(64)}`;
export const dependencyFindingsObservedFixture: SecurityIntelligenceAssessmentV1 =
	{
		contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		assessmentRef:
			"sia:v1:3bee2440036fac01626433988bb9378145266c379645481233142bc492e4fb28",
		producer: { system: "vulnWorkbench", version: "1.0.0" },
		projectRef: "project:fixture",
		source: {
			scanRunRef: "scan-run:dependency-findings",
			completedAt: "2026-08-15T00:01:00.000Z",
		},
		target: {
			kind: "diff",
			sourceRevision: "b".repeat(40),
			targetDigest: digest("a"),
		},
		scope: {
			profileRef: "diff-basic-security",
			declaredInvariantRefs: [],
			threatModelRefs: [],
		},
		outcome: "findings_observed",
		claims: [
			{
				claimRef: "claim:dependency-state-changed",
				origin: "observed",
				subject: "npm dependency state",
				predicate: "dependency_state_changed",
				summary: "The npm dependency manifest changed in the requested diff.",
				confidence: "high",
				evidenceRefs: ["artifact:diff-manifest"],
			},
		],
		verifications: [
			{
				verificationRef: "verification:osv",
				capabilityRef: "dependency-vulnerability:osv",
				required: true,
				status: "tested",
				reasonCode: "completed_with_findings",
				summary: "OSV completed and reported one dependency finding.",
				evidenceRefs: [
					"artifact:diff-manifest",
					"finding:osv:fixture",
					"tool-run:osv",
				],
				findingRefs: ["finding:osv:fixture"],
			},
		],
		evidenceRefs: [
			{
				ref: "artifact:diff-manifest",
				kind: "scan_artifact",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:dependency-findings",
				targetDigest: digest("a"),
				digest: digest("1"),
			},
			{
				ref: "finding:osv:fixture",
				kind: "finding",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:dependency-findings",
				targetDigest: digest("a"),
				digest: digest("2"),
			},
			{
				ref: "tool-run:osv",
				kind: "tool_run",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:dependency-findings",
				targetDigest: digest("a"),
				digest: digest("3"),
			},
		],
		findingRefs: ["finding:osv:fixture"],
		coverage: {
			covered: [
				"Dependency manifests changed in the requested diff",
				"Known dependency vulnerabilities reported by OSV",
			],
			gaps: ["Registry changes after the scanner data snapshot"],
			limitationCodes: ["scanner_data_point_in_time"],
		},
		unknowns: [],
		residualRisk: [
			"Unpublished vulnerabilities and project-specific exploitability remain unverified",
		],
		generatedAt: "2026-08-15T00:02:00.000Z",
	};

export const dependencyNoFindingsObservedFixture: SecurityIntelligenceAssessmentV1 =
	{
		contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		assessmentRef:
			"sia:v1:7f1642e5783366aa0fd7b834bb61479c2f3b977b3326509066e75d6ca4550c51",
		producer: { system: "vulnWorkbench", version: "1.0.0" },
		projectRef: "project:fixture",
		source: {
			scanRunRef: "scan-run:dependency-zero",
			completedAt: "2026-08-15T01:01:00.000Z",
		},
		target: {
			kind: "diff",
			sourceRevision: "c".repeat(40),
			targetDigest: digest("b"),
		},
		scope: {
			profileRef: "diff-basic-security",
			declaredInvariantRefs: [],
			threatModelRefs: [],
		},
		outcome: "no_findings_observed",
		claims: [],
		verifications: [
			{
				verificationRef: "verification:osv",
				capabilityRef: "dependency-vulnerability:osv",
				required: true,
				status: "tested",
				reasonCode: "completed_without_findings",
				summary: "OSV completed without reporting a dependency finding.",
				evidenceRefs: ["artifact:diff-manifest", "tool-run:osv"],
				findingRefs: [],
			},
		],
		evidenceRefs: [
			{
				ref: "artifact:diff-manifest",
				kind: "scan_artifact",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:dependency-zero",
				targetDigest: digest("b"),
				digest: digest("4"),
			},
			{
				ref: "tool-run:osv",
				kind: "tool_run",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:dependency-zero",
				targetDigest: digest("b"),
				digest: digest("5"),
			},
		],
		findingRefs: [],
		coverage: {
			covered: [
				"Dependency manifests changed in the requested diff",
				"Known dependency vulnerabilities reported by OSV",
			],
			gaps: ["Registry changes after the scanner data snapshot"],
			limitationCodes: ["scanner_data_point_in_time"],
		},
		unknowns: [],
		residualRisk: [
			"No finding does not establish that the dependency graph is safe",
		],
		generatedAt: "2026-08-15T01:02:00.000Z",
	};

export const dependencyInconclusiveFixture: SecurityIntelligenceAssessmentV1 = {
	contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
	assessmentRef:
		"sia:v1:98c42550f94d350fffce7c6549b1364dafd9722cd4123554959726ac04c6f9bd",
	producer: { system: "vulnWorkbench", version: "1.0.0" },
	projectRef: "project:fixture",
	source: {
		scanRunRef: "scan-run:dependency-inconclusive",
		completedAt: "2026-08-15T02:01:00.000Z",
	},
	target: {
		kind: "diff",
		sourceRevision: "d".repeat(40),
		targetDigest: digest("c"),
	},
	scope: {
		profileRef: "diff-basic-security",
		declaredInvariantRefs: [],
		threatModelRefs: [],
	},
	outcome: "inconclusive",
	claims: [],
	verifications: [
		{
			verificationRef: "verification:osv",
			capabilityRef: "dependency-vulnerability:osv",
			required: true,
			status: "failed",
			reasonCode: "tool_execution_failed",
			summary: "OSV did not complete, so dependency findings are unknown.",
			evidenceRefs: ["artifact:diff-manifest", "report:osv-failure"],
			findingRefs: [],
		},
	],
	evidenceRefs: [
		{
			ref: "artifact:diff-manifest",
			kind: "scan_artifact",
			targetRole: "assessment_target",
			scanRunRef: "scan-run:dependency-inconclusive",
			targetDigest: digest("c"),
			digest: digest("6"),
		},
		{
			ref: "report:osv-failure",
			kind: "report",
			targetRole: "assessment_target",
			scanRunRef: "scan-run:dependency-inconclusive",
			targetDigest: digest("c"),
			digest: digest("7"),
		},
	],
	findingRefs: [],
	coverage: {
		covered: ["Dependency manifests changed in the requested diff"],
		gaps: ["Dependency vulnerability lookup"],
		limitationCodes: ["required_tool_failed"],
	},
	unknowns: ["Known-vulnerability status of the changed dependency graph"],
	residualRisk: ["Changed dependencies remain unverified"],
	generatedAt: "2026-08-15T02:02:00.000Z",
};

export const dependencyUnavailableFixture: SecurityIntelligenceAssessmentV1 = {
	contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
	assessmentRef:
		"sia:v1:c22f25d1f0413a815f11bc8c6c027e6905c597dc93b075949dfb578a4a0f3033",
	producer: { system: "vulnWorkbench", version: "1.0.0" },
	projectRef: "project:fixture",
	source: {
		scanRunRef: "scan-run:dependency-unavailable",
		completedAt: "2026-08-15T02:31:00.000Z",
	},
	target: {
		kind: "snapshot",
		sourceRevision: "1".repeat(40),
		targetDigest: digest("f"),
	},
	scope: {
		profileRef: "dependency-security",
		declaredInvariantRefs: [],
		threatModelRefs: [],
	},
	outcome: "unavailable",
	claims: [],
	verifications: [
		{
			verificationRef: "verification:osv",
			capabilityRef: "dependency-vulnerability:osv",
			required: true,
			status: "unavailable",
			reasonCode: "tool_unavailable",
			summary: "OSV was unavailable for the requested snapshot.",
			evidenceRefs: ["report:osv-unavailable"],
			findingRefs: [],
		},
	],
	evidenceRefs: [
		{
			ref: "report:osv-unavailable",
			kind: "report",
			targetRole: "assessment_target",
			scanRunRef: "scan-run:dependency-unavailable",
			targetDigest: digest("f"),
			digest: digest("c"),
		},
	],
	findingRefs: [],
	coverage: {
		covered: ["Dependency verification applicability"],
		gaps: ["Dependency vulnerability lookup"],
		limitationCodes: ["required_tool_unavailable"],
	},
	unknowns: ["Known-vulnerability status of the dependency graph"],
	residualRisk: ["Dependencies remain unverified"],
	generatedAt: "2026-08-15T02:32:00.000Z",
};

export const authorizationShadowObservedFixture: SecurityIntelligenceAssessmentV1 =
	{
		contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		assessmentRef:
			"sia:v1:0deb1eaebefbb7625ecb88171406d6fbd05e56d120a68b74aabdd164079c4c61",
		producer: { system: "vulnWorkbench", version: "1.0.0" },
		projectRef: "project:fixture",
		source: {
			scanRunRef: "scan-run:authorization-shadow",
			completedAt: "2026-08-15T03:01:00.000Z",
		},
		target: {
			kind: "diff",
			sourceRevision: "e".repeat(40),
			targetDigest: digest("d"),
			baseRevision: "d".repeat(40),
			headRevision: "e".repeat(40),
			baseTargetDigest: digest("c"),
		},
		scope: {
			profileRef: "authorization-shadow",
			declaredInvariantRefs: ["invariant:admin-route-authorization"],
			threatModelRefs: ["threat-model:fixture"],
		},
		outcome: "no_findings_observed",
		claims: [
			{
				claimRef: "claim:admin-route-guard-observed",
				origin: "observed",
				subject: "GET /admin/users",
				predicate: "authorization_guard_observed",
				summary:
					"The same explicit authorization guard was observed before and after the change.",
				confidence: "high",
				evidenceRefs: ["application-model:after", "application-model:before"],
			},
		],
		verifications: [
			{
				verificationRef: "verification:authorization-shadow",
				capabilityRef: "authorization-boundary:typescript-http",
				required: false,
				status: "tested",
				reasonCode: "boundary_unchanged",
				summary: "Authorization boundary comparison completed in shadow mode.",
				evidenceRefs: ["application-model:after", "application-model:before"],
				findingRefs: [],
			},
		],
		evidenceRefs: [
			{
				ref: "application-model:after",
				kind: "application_model",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:authorization-shadow",
				targetDigest: digest("d"),
				digest: digest("8"),
			},
			{
				ref: "application-model:before",
				kind: "application_model",
				targetRole: "base_target",
				scanRunRef: "scan-run:authorization-shadow",
				targetDigest: digest("c"),
				digest: digest("9"),
			},
		],
		findingRefs: [],
		coverage: {
			covered: ["Explicit guards on statically extracted TypeScript routes"],
			gaps: ["Runtime policy decisions and dynamically registered routes"],
			limitationCodes: ["authorization_shadow_only"],
		},
		unknowns: [],
		residualRisk: [
			"Observed guard presence does not establish correct runtime authorization",
		],
		generatedAt: "2026-08-15T03:02:00.000Z",
	};

export const authorizationCoverageLostFixture: SecurityIntelligenceAssessmentV1 =
	{
		contractVersion: SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		assessmentRef:
			"sia:v1:f8707c52d5e02864b25f048ed2065f2a954835983ac38b47116ca84b9e5b6ba2",
		producer: { system: "vulnWorkbench", version: "1.0.0" },
		projectRef: "project:fixture",
		source: {
			scanRunRef: "scan-run:authorization-coverage-lost",
			completedAt: "2026-08-15T04:01:00.000Z",
		},
		target: {
			kind: "diff",
			sourceRevision: "f".repeat(40),
			targetDigest: digest("e"),
			baseRevision: "e".repeat(40),
			headRevision: "f".repeat(40),
			baseTargetDigest: digest("d"),
		},
		scope: {
			profileRef: "authorization-shadow",
			declaredInvariantRefs: ["invariant:admin-route-authorization"],
			threatModelRefs: ["threat-model:fixture"],
		},
		outcome: "inconclusive",
		claims: [
			{
				claimRef: "claim:authorization-coverage-lost",
				origin: "observed",
				subject: "TypeScript authorization boundary extraction",
				predicate: "coverage_lost",
				summary:
					"The before snapshot was available but the after snapshot could not be parsed.",
				confidence: "high",
				evidenceRefs: ["application-model:before", "report:analyzer-failure"],
			},
		],
		verifications: [
			{
				verificationRef: "verification:authorization-shadow",
				capabilityRef: "authorization-boundary:typescript-http",
				required: false,
				status: "unavailable",
				reasonCode: "after_snapshot_parse_failed",
				summary:
					"Authorization boundary comparison was unavailable for the after snapshot.",
				evidenceRefs: ["application-model:before", "report:analyzer-failure"],
				findingRefs: [],
			},
		],
		evidenceRefs: [
			{
				ref: "application-model:before",
				kind: "application_model",
				targetRole: "base_target",
				scanRunRef: "scan-run:authorization-coverage-lost",
				targetDigest: digest("d"),
				digest: digest("a"),
			},
			{
				ref: "report:analyzer-failure",
				kind: "report",
				targetRole: "assessment_target",
				scanRunRef: "scan-run:authorization-coverage-lost",
				targetDigest: digest("e"),
				digest: digest("b"),
			},
		],
		findingRefs: [],
		coverage: {
			covered: ["Before-revision authorization boundary extraction"],
			gaps: ["After-revision authorization boundary extraction"],
			limitationCodes: ["authorization_after_parse_failed"],
		},
		unknowns: ["Whether authorization guards changed in the after revision"],
		residualRisk: ["Authorization regressions may be present in unparsed code"],
		generatedAt: "2026-08-15T04:02:00.000Z",
	};

export const positiveSecurityIntelligenceAssessmentFixtures = {
	"authorization-coverage-lost": authorizationCoverageLostFixture,
	"authorization-shadow-observed": authorizationShadowObservedFixture,
	"dependency-findings-observed": dependencyFindingsObservedFixture,
	"dependency-inconclusive": dependencyInconclusiveFixture,
	"dependency-no-findings-observed": dependencyNoFindingsObservedFixture,
	"dependency-unavailable": dependencyUnavailableFixture,
} as const satisfies Record<string, SecurityIntelligenceAssessmentV1>;
