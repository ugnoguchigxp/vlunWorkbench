import type { SecurityIntelligenceAssessmentV1 } from "../../../shared/schemas/security-intelligence-assessment.schema";
import type {
	AuthorizationBoundaryChange,
	AuthorizationBoundaryDiff,
	AuthorizationBoundarySnapshot,
} from "../../../shared/schemas/security-intelligence-authorization.schema";
import {
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
} from "../../../shared/security-intelligence-assessment-contract";
import { diffAuthorizationBoundaries } from "./authorization-boundary-diff";

export type AuthorizationShadowTarget = {
	baseRevision: string;
	baseTargetDigest: string;
	sourceRevision: string;
	targetDigest: string;
};

export type RunAuthorizationShadowInput = {
	enabled?: boolean;
	producerVersion: string;
	projectRef: string;
	scanRunRef: string;
	profileRef: string;
	completedAt: string;
	generatedAt: string;
	target: AuthorizationShadowTarget;
	before: AuthorizationBoundarySnapshot;
	after: AuthorizationBoundarySnapshot;
	declaredInvariantRefs?: readonly string[];
	threatModelRefs?: readonly string[];
};

export type AuthorizationShadowResult = {
	diff: AuthorizationBoundaryDiff;
	assessment: SecurityIntelligenceAssessmentV1;
};

export class AuthorizationShadowTargetError extends Error {
	constructor(readonly code: string) {
		super(`security_intelligence:${code}`);
		this.name = "AuthorizationShadowTargetError";
	}
}

export function runAuthorizationShadow(
	input: RunAuthorizationShadowInput,
): AuthorizationShadowResult | null {
	if (input.enabled !== true) return null;
	assertTargetBinding(input);
	const diff = diffAuthorizationBoundaries(input.before, input.after);
	assertDiffTarget(input, diff);
	return {
		diff,
		assessment: buildAuthorizationShadowAssessment(input, diff),
	};
}

function buildAuthorizationShadowAssessment(
	input: RunAuthorizationShadowInput,
	diff: AuthorizationBoundaryDiff,
): SecurityIntelligenceAssessmentV1 {
	const beforeEvidenceRef = `application-model:authorization-before:${digestTail(input.before.snapshotDigest)}`;
	const afterEvidenceRef = `application-model:authorization-after:${digestTail(input.after.snapshotDigest)}`;
	const evidenceRefs = (
		[
			{
				ref: afterEvidenceRef,
				kind: "application_model",
				targetRole: "assessment_target",
				scanRunRef: input.scanRunRef,
				targetDigest: input.target.targetDigest,
				digest: asSha256(input.after.snapshotDigest),
			},
			{
				ref: beforeEvidenceRef,
				kind: "application_model",
				targetRole: "base_target",
				scanRunRef: input.scanRunRef,
				targetDigest: input.target.baseTargetDigest,
				digest: asSha256(input.before.snapshotDigest),
			},
		] satisfies SecurityIntelligenceAssessmentV1["evidenceRefs"]
	).sort((left, right) => compare(left.ref, right.ref));
	const outcome = assessmentOutcome(diff);
	const verificationStatus =
		diff.analyzer.status === "ready"
			? "tested"
			: diff.analyzer.status === "unavailable"
				? "unavailable"
				: "not_tested";
	const verificationReason =
		verificationStatus === "tested"
			? "authorization_shadow_completed"
			: verificationStatus === "unavailable"
				? "authorization_shadow_unavailable"
				: "authorization_shadow_degraded";
	const assessment: SecurityIntelligenceAssessmentV1 = {
		contractVersion: "1",
		assessmentRef: `sia:v1:${"0".repeat(64)}`,
		producer: { system: "vulnWorkbench", version: input.producerVersion },
		projectRef: input.projectRef,
		source: {
			scanRunRef: input.scanRunRef,
			completedAt: input.completedAt,
		},
		target: {
			kind: "diff",
			sourceRevision: input.target.sourceRevision,
			targetDigest: input.target.targetDigest,
			baseRevision: input.target.baseRevision,
			headRevision: input.target.sourceRevision,
			baseTargetDigest: input.target.baseTargetDigest,
		},
		scope: {
			profileRef: input.profileRef,
			declaredInvariantRefs: canonicalStrings(
				input.declaredInvariantRefs ?? [],
			),
			threatModelRefs: canonicalStrings(input.threatModelRefs ?? []),
		},
		outcome,
		claims: aggregateClaims(diff.changes, [
			beforeEvidenceRef,
			afterEvidenceRef,
		]),
		verifications: [
			{
				verificationRef: "verification:authorization-shadow",
				capabilityRef: "authorization-boundary:typescript-javascript-http",
				required: false,
				status: verificationStatus,
				reasonCode: verificationReason,
				summary:
					verificationStatus === "tested"
						? "Authorization boundary comparison completed in shadow mode."
						: "Authorization boundary comparison did not have complete shadow coverage.",
				evidenceRefs: [beforeEvidenceRef, afterEvidenceRef].sort(compare),
				findingRefs: [],
			},
		],
		evidenceRefs,
		findingRefs: [],
		coverage: {
			covered: [
				"Explicit guards on statically extracted JavaScript and TypeScript HTTP routes",
			],
			gaps: coverageGaps(diff, outcome),
			limitationCodes: canonicalStrings([
				"authorization_shadow_only",
				...diff.limitationCodes,
				...diff.changes.flatMap((change) => change.limitationCodes),
			]),
		},
		unknowns:
			outcome === "inconclusive" || outcome === "unavailable"
				? ["Authorization enforcement outside observed static boundaries"]
				: [],
		residualRisk: [
			"Observed guard presence does not establish correct runtime authorization",
		],
		generatedAt: input.generatedAt,
	};
	assessment.assessmentRef =
		deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}

function assertTargetBinding(input: RunAuthorizationShadowInput): void {
	if (
		input.before.projectRef !== input.projectRef ||
		input.after.projectRef !== input.projectRef
	) {
		throw new AuthorizationShadowTargetError("authorization_project_mismatch");
	}
	if (
		input.before.target.sourceRevision !== input.target.baseRevision ||
		input.before.target.targetDigest !== input.target.baseTargetDigest
	) {
		throw new AuthorizationShadowTargetError(
			"authorization_base_target_mismatch",
		);
	}
	if (
		input.after.target.sourceRevision !== input.target.sourceRevision ||
		input.after.target.targetDigest !== input.target.targetDigest
	) {
		throw new AuthorizationShadowTargetError(
			"authorization_assessment_target_mismatch",
		);
	}
}

function assertDiffTarget(
	input: RunAuthorizationShadowInput,
	diff: AuthorizationBoundaryDiff,
): void {
	if (
		diff.target.baseRevision !== input.target.baseRevision ||
		diff.target.baseTargetDigest !== input.target.baseTargetDigest ||
		diff.target.sourceRevision !== input.target.sourceRevision ||
		diff.target.targetDigest !== input.target.targetDigest
	) {
		throw new AuthorizationShadowTargetError(
			"authorization_diff_target_mismatch",
		);
	}
}

function assessmentOutcome(
	diff: AuthorizationBoundaryDiff,
): SecurityIntelligenceAssessmentV1["outcome"] {
	if (diff.analyzer.status === "unavailable") return "unavailable";
	if (diff.analyzer.status !== "ready") return "inconclusive";
	const highSignal = diff.changes.some(
		(change) =>
			change.classification === "worsened" ||
			change.classification === "unknown" ||
			change.classification === "coverage_lost" ||
			(change.classification === "introduced" &&
				change.afterGuardState === "unguarded"),
	);
	return highSignal ? "inconclusive" : "no_findings_observed";
}

function aggregateClaims(
	changes: readonly AuthorizationBoundaryChange[],
	evidenceRefs: string[],
): SecurityIntelligenceAssessmentV1["claims"] {
	const classifications = [
		...new Set(changes.map((change) => change.classification)),
	].sort(compare);
	return classifications.map((classification) => ({
		claimRef: `claim:authorization-boundary:${classification}`,
		origin: "observed" as const,
		subject: "Authorization boundaries",
		predicate: `authorization_boundary_${classification}`,
		summary: claimSummary(classification),
		confidence:
			classification === "unknown" || classification === "coverage_lost"
				? ("low" as const)
				: ("high" as const),
		evidenceRefs: [...evidenceRefs].sort(compare),
	}));
}

function claimSummary(
	classification: AuthorizationBoundaryChange["classification"],
): string {
	const summaries = {
		introduced: "One or more authorization boundaries were introduced.",
		worsened:
			"One or more stable authorization boundaries changed from guarded to unguarded.",
		unchanged: "One or more authorization boundaries remained unchanged.",
		resolved:
			"One or more stable authorization boundaries changed from unguarded to guarded.",
		removed: "One or more authorization boundaries were removed.",
		coverage_lost:
			"Authorization boundary coverage was lost for one or more prior boundaries.",
		unknown:
			"One or more authorization boundary changes could not be classified safely.",
	} satisfies Record<AuthorizationBoundaryChange["classification"], string>;
	return summaries[classification];
}

function coverageGaps(
	diff: AuthorizationBoundaryDiff,
	outcome: SecurityIntelligenceAssessmentV1["outcome"],
): string[] {
	return canonicalStrings([
		"Runtime policy decisions and dynamically registered routes",
		...(outcome === "inconclusive" || outcome === "unavailable"
			? ["Complete static authorization boundary comparison"]
			: []),
		...(diff.changes.some((change) => change.classification === "worsened")
			? ["Shadow observations are not vulnerability verdicts"]
			: []),
	]);
}

function asSha256(value: string): `sha256:${string}` {
	return `sha256:${digestTail(value)}`;
}

function digestTail(value: string): string {
	const tail = value.slice(value.lastIndexOf(":") + 1);
	if (!/^[a-f0-9]{64}$/.test(tail)) {
		throw new Error("security_intelligence:authorization_digest_invalid");
	}
	return tail;
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compare);
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
