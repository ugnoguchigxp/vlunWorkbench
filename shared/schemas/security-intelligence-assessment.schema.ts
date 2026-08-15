import { z } from "zod";
import {
	isCanonicalSecurityIntelligenceOrder,
	securityIntelligenceCanonicalOpaqueRefsSchema,
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceCanonicalSafeTextsSchema,
	securityIntelligenceClaimSchema,
	securityIntelligenceEvidenceRefSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceOutcomeSchema,
	securityIntelligenceProducerVersionSchema,
	securityIntelligenceTargetSchema,
	securityIntelligenceTimestampSchema,
	securityIntelligenceVerificationSchema,
} from "./security-intelligence-assessment-components.schema";

export {
	securityIntelligenceClaimOriginSchema,
	securityIntelligenceClaimSchema,
	securityIntelligenceEvidenceKindSchema,
	securityIntelligenceEvidenceRefSchema,
	securityIntelligenceOutcomeSchema,
	securityIntelligenceRepositoryPathSchema,
	securityIntelligenceSafeTextSchema,
	securityIntelligenceTargetKindSchema,
	securityIntelligenceTargetSchema,
	securityIntelligenceVerificationSchema,
	securityIntelligenceVerificationStatusSchema,
} from "./security-intelligence-assessment-components.schema";

export const SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION = "1" as const;

const assessmentRefSchema = z.string().regex(/^sia:v1:[a-f0-9]{64}$/);

export const securityIntelligenceAssessmentV1Schema = z
	.object({
		contractVersion: z.literal(
			SECURITY_INTELLIGENCE_ASSESSMENT_CONTRACT_VERSION,
		),
		assessmentRef: assessmentRefSchema,
		producer: z
			.object({
				system: z.literal("vulnWorkbench"),
				version: securityIntelligenceProducerVersionSchema,
			})
			.strict(),
		projectRef: securityIntelligenceOpaqueRefSchema,
		source: z
			.object({
				scanRunRef: securityIntelligenceOpaqueRefSchema,
				completedAt: securityIntelligenceTimestampSchema,
			})
			.strict(),
		target: securityIntelligenceTargetSchema,
		scope: z
			.object({
				profileRef: securityIntelligenceOpaqueRefSchema,
				declaredInvariantRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
				threatModelRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
			})
			.strict(),
		outcome: securityIntelligenceOutcomeSchema,
		claims: z.array(securityIntelligenceClaimSchema).max(500),
		verifications: z
			.array(securityIntelligenceVerificationSchema)
			.min(1)
			.max(200),
		evidenceRefs: z.array(securityIntelligenceEvidenceRefSchema).max(1_000),
		findingRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		coverage: z
			.object({
				covered: securityIntelligenceCanonicalSafeTextsSchema,
				gaps: securityIntelligenceCanonicalSafeTextsSchema,
				limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
			})
			.strict(),
		unknowns: securityIntelligenceCanonicalSafeTextsSchema,
		residualRisk: securityIntelligenceCanonicalSafeTextsSchema,
		generatedAt: securityIntelligenceTimestampSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		const addIssue = (path: Array<string | number>, reason: string): void => {
			ctx.addIssue({
				code: "custom",
				path,
				message: `security_intelligence:${reason}`,
			});
		};

		const claimRefs = value.claims.map((claim) => claim.claimRef);
		if (!isCanonicalSecurityIntelligenceOrder(claimRefs)) {
			addIssue(["claims"], "claims_must_be_unique_and_canonically_sorted");
		}

		const verificationRefs = value.verifications.map(
			(verification) => verification.verificationRef,
		);
		if (!isCanonicalSecurityIntelligenceOrder(verificationRefs)) {
			addIssue(
				["verifications"],
				"verifications_must_be_unique_and_canonically_sorted",
			);
		}

		const evidenceIds = value.evidenceRefs.map((evidence) => evidence.ref);
		if (!isCanonicalSecurityIntelligenceOrder(evidenceIds)) {
			addIssue(
				["evidenceRefs"],
				"evidence_must_be_unique_and_canonically_sorted",
			);
		}
		const knownEvidenceIds = new Set(evidenceIds);

		for (const [index, evidence] of value.evidenceRefs.entries()) {
			if (evidence.scanRunRef !== value.source.scanRunRef) {
				addIssue(
					["evidenceRefs", index, "scanRunRef"],
					"evidence_scan_run_mismatch",
				);
			}
			const expectedTargetDigest =
				evidence.targetRole === "assessment_target"
					? value.target.targetDigest
					: value.target.baseTargetDigest;
			if (
				expectedTargetDigest === undefined ||
				evidence.targetDigest !== expectedTargetDigest
			) {
				addIssue(
					["evidenceRefs", index, "targetDigest"],
					"evidence_target_mismatch",
				);
			}
		}

		const assertKnownEvidence = (
			refs: readonly string[],
			pathPrefix: Array<string | number>,
		) => {
			for (const [index, ref] of refs.entries()) {
				if (!knownEvidenceIds.has(ref)) {
					addIssue([...pathPrefix, index], "unknown_evidence_reference");
				}
			}
		};

		for (const [index, claim] of value.claims.entries()) {
			assertKnownEvidence(claim.evidenceRefs, [
				"claims",
				index,
				"evidenceRefs",
			]);
		}
		for (const [index, verification] of value.verifications.entries()) {
			assertKnownEvidence(verification.evidenceRefs, [
				"verifications",
				index,
				"evidenceRefs",
			]);
			const verificationEvidenceIds = new Set(verification.evidenceRefs);
			for (const [
				findingIndex,
				findingRef,
			] of verification.findingRefs.entries()) {
				if (!verificationEvidenceIds.has(findingRef)) {
					addIssue(
						["verifications", index, "findingRefs", findingIndex],
						"verification_finding_requires_linked_evidence",
					);
				}
			}
		}

		const verificationFindingRefs = [
			...new Set(
				value.verifications.flatMap((verification) => verification.findingRefs),
			),
		].sort();
		if (
			JSON.stringify(verificationFindingRefs) !==
			JSON.stringify(value.findingRefs)
		) {
			addIssue(["findingRefs"], "finding_refs_must_match_verifications");
		}

		const findingEvidenceRefs = value.evidenceRefs
			.filter((evidence) => evidence.kind === "finding")
			.map((evidence) => evidence.ref)
			.sort();
		if (
			JSON.stringify(findingEvidenceRefs) !== JSON.stringify(value.findingRefs)
		) {
			addIssue(["findingRefs"], "finding_refs_must_match_finding_evidence");
		}

		if (
			value.outcome === "findings_observed" &&
			value.findingRefs.length === 0
		) {
			addIssue(["findingRefs"], "findings_observed_requires_finding");
		}
		if (value.outcome !== "findings_observed" && value.findingRefs.length > 0) {
			addIssue(["outcome"], "referenced_findings_require_findings_observed");
		}

		if (value.outcome === "no_findings_observed") {
			if (!value.verifications.some((item) => item.status === "tested")) {
				addIssue(["verifications"], "no_findings_requires_tested_verification");
			}
			if (
				value.verifications.some(
					(item) => item.required && item.status !== "tested",
				)
			) {
				addIssue(
					["verifications"],
					"no_findings_requires_required_verifications_tested",
				);
			}
			if (value.coverage.covered.length === 0) {
				addIssue(
					["coverage", "covered"],
					"no_findings_requires_explicit_coverage",
				);
			}
		}

		if (
			value.outcome === "inconclusive" &&
			value.coverage.gaps.length === 0 &&
			value.coverage.limitationCodes.length === 0 &&
			value.unknowns.length === 0
		) {
			addIssue(["coverage"], "inconclusive_requires_limitation_or_unknown");
		}

		if (value.outcome === "unavailable") {
			if (
				value.verifications.some(
					(verification) =>
						verification.status === "tested" ||
						verification.status === "failed",
				)
			) {
				addIssue(
					["verifications"],
					"unavailable_cannot_include_executed_verification",
				);
			}
			if (
				!value.verifications.some(
					(verification) => verification.status === "unavailable",
				)
			) {
				addIssue(
					["verifications"],
					"unavailable_requires_unavailable_verification",
				);
			}
			if (
				value.coverage.gaps.length === 0 &&
				value.coverage.limitationCodes.length === 0 &&
				value.unknowns.length === 0
			) {
				addIssue(["coverage"], "unavailable_requires_limitation_or_unknown");
			}
		}

		if (Date.parse(value.generatedAt) < Date.parse(value.source.completedAt)) {
			addIssue(["generatedAt"], "generated_at_precedes_source_completion");
		}
	});

export type SecurityIntelligenceAssessmentV1 = z.infer<
	typeof securityIntelligenceAssessmentV1Schema
>;
