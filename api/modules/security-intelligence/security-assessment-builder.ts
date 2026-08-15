import type { z } from "zod";
import type {
	SecurityIntelligenceAssessmentV1,
	securityIntelligenceVerificationStatusSchema,
} from "../../../shared/schemas/security-intelligence-assessment.schema";
import {
	deriveSecurityIntelligenceAssessmentRef,
	parseSecurityIntelligenceAssessmentV1,
} from "../../../shared/security-intelligence-assessment-contract";
import type { DependencyChangeObservation } from "./dependency-change-observer";

type VerificationStatus = z.infer<
	typeof securityIntelligenceVerificationStatusSchema
>;

export type DependencyAssessmentEvidenceInput =
	SecurityIntelligenceAssessmentV1["evidenceRefs"][number];

export type DependencyVerificationInput = {
	toolId: "dependency" | "osv" | "trivy";
	required: boolean;
	status: VerificationStatus;
	reasonCode: string;
	summary: string;
	evidenceRefs: DependencyAssessmentEvidenceInput[];
	findingRefs: string[];
};

export type BuildDependencyAssessmentInput = {
	producerVersion: string;
	projectRef: string;
	scanRunRef: string;
	profileRef: string;
	completedAt: string;
	generatedAt: string;
	target: {
		sourceRevision: string;
		targetDigest: string;
	};
	manifestEvidence: DependencyAssessmentEvidenceInput;
	observation: DependencyChangeObservation;
	verifications: DependencyVerificationInput[];
};

export function buildDependencyAssessment(
	input: BuildDependencyAssessmentInput,
): SecurityIntelligenceAssessmentV1 {
	if (input.verifications.length === 0) {
		throw new Error("security_intelligence:dependency_verification_required");
	}
	const verifications = canonicalVerifications(input.verifications);
	const evidenceRefs = canonicalEvidence([
		input.manifestEvidence,
		...verifications.flatMap((verification) => verification.evidenceRefs),
	]);
	const findingRefs = canonicalStrings(
		verifications.flatMap((verification) => verification.findingRefs),
	);
	const outcome = decideOutcome({
		dependencyStateChanged: input.observation.dependencyStateChanged,
		findingCount: findingRefs.length,
		verifications,
	});
	const limitations = canonicalStrings([
		...input.observation.limitationCodes,
		...verifications.flatMap((verification) =>
			verification.status === "tested" ? [] : [verification.reasonCode],
		),
	]);
	const gaps = canonicalStrings([
		...input.observation.gaps,
		...verificationGaps(verifications),
	]);
	const unknowns =
		outcome === "inconclusive" || outcome === "unavailable"
			? ["Dependency vulnerability status is not fully verified"]
			: [];
	const residualRisk = [
		outcome === "no_findings_observed"
			? "No finding does not establish that the dependency graph is safe"
			: outcome === "findings_observed"
				? "Additional dependency vulnerabilities may remain outside observed coverage"
				: "Dependency vulnerabilities may remain unobserved in incomplete coverage",
	];

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
		},
		scope: {
			profileRef: input.profileRef,
			declaredInvariantRefs: [],
			threatModelRefs: [],
		},
		outcome,
		claims: input.observation.dependencyStateChanged
			? [
					{
						claimRef: "claim:dependency-state-changed",
						origin: "observed",
						subject: "Dependency state",
						predicate: "dependency_state_changed",
						summary: input.observation.lockStateChanged
							? "Dependency manifest or lock state changed in the saved diff manifest."
							: "Dependency manifest state changed in the saved diff manifest.",
						confidence: "high",
						evidenceRefs: [input.manifestEvidence.ref],
					},
				]
			: [],
		verifications: verifications.map((verification) => ({
			verificationRef: `verification:${verification.toolId}`,
			capabilityRef: `dependency-vulnerability:${verification.toolId}`,
			required: verification.required,
			status: verification.status,
			reasonCode: verification.reasonCode,
			summary: verification.summary,
			evidenceRefs: canonicalStrings(
				verification.evidenceRefs.map((evidence) => evidence.ref),
			),
			findingRefs: canonicalStrings(verification.findingRefs),
		})),
		evidenceRefs,
		findingRefs,
		coverage: {
			covered: canonicalStrings(input.observation.covered),
			gaps,
			limitationCodes: limitations,
		},
		unknowns,
		residualRisk,
		generatedAt: input.generatedAt,
	};
	assessment.assessmentRef =
		deriveSecurityIntelligenceAssessmentRef(assessment);
	return parseSecurityIntelligenceAssessmentV1(assessment);
}

function canonicalVerifications(
	verifications: readonly DependencyVerificationInput[],
): DependencyVerificationInput[] {
	const byTool = new Map<string, DependencyVerificationInput>();
	for (const verification of verifications) {
		if (byTool.has(verification.toolId)) {
			throw new Error(
				"security_intelligence:duplicate_dependency_verification",
			);
		}
		byTool.set(verification.toolId, verification);
	}
	return [...byTool.values()].sort((left, right) =>
		compareCodeUnits(left.toolId, right.toolId),
	);
}

function canonicalEvidence(
	evidence: readonly DependencyAssessmentEvidenceInput[],
): DependencyAssessmentEvidenceInput[] {
	const byRef = new Map<string, DependencyAssessmentEvidenceInput>();
	for (const item of evidence) {
		const existing = byRef.get(item.ref);
		if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
			throw new Error("security_intelligence:conflicting_evidence_reference");
		}
		byRef.set(item.ref, item);
	}
	return [...byRef.values()].sort((left, right) =>
		compareCodeUnits(left.ref, right.ref),
	);
}

function decideOutcome(params: {
	dependencyStateChanged: boolean;
	findingCount: number;
	verifications: readonly DependencyVerificationInput[];
}): SecurityIntelligenceAssessmentV1["outcome"] {
	if (params.findingCount > 0) return "findings_observed";
	if (!params.dependencyStateChanged) return "inconclusive";
	const tested = params.verifications.some(
		(verification) => verification.status === "tested",
	);
	const requiredComplete = params.verifications.every(
		(verification) =>
			!verification.required || verification.status === "tested",
	);
	if (tested && requiredComplete) return "no_findings_observed";
	const noneExecuted = params.verifications.every(
		(verification) =>
			verification.status !== "tested" && verification.status !== "failed",
	);
	const unavailable = params.verifications.some(
		(verification) => verification.status === "unavailable",
	);
	return noneExecuted && unavailable ? "unavailable" : "inconclusive";
}

function verificationGaps(
	verifications: readonly DependencyVerificationInput[],
): string[] {
	return verifications.flatMap((verification) => {
		if (verification.status === "tested") return [];
		const label =
			verification.toolId === "osv"
				? "OSV"
				: verification.toolId === "trivy"
					? "Trivy"
					: "Dependency scanner";
		return [`${label} verification was not completed`];
	});
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
