import { z } from "zod";
import { NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION } from "./nightworkers-security-intelligence.schema";
import {
	securityIntelligenceCanonicalOpaqueRefsSchema,
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceOutcomeSchema,
	securityIntelligenceRevisionSchema,
	securityIntelligenceSha256DigestSchema,
	securityIntelligenceTimestampSchema,
} from "./security-intelligence-assessment-components.schema";

export const NIGHTWORKERS_SECURITY_INTELLIGENCE_INTEGRITY_EVIDENCE_VERSION =
	"security-intelligence-nightworkers-integrity-evidence-v2" as const;

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const bundleRefSchema = z.string().regex(/^sib:v1:[a-f0-9]{64}$/);
const assessmentRefSchema = z.string().regex(/^sia:v1:[a-f0-9]{64}$/);
const securityContractRefSchema = z.string().regex(/^sic:v1:[a-f0-9]{64}$/);
const finalJudgmentRefSchema = z.string().regex(/^sifj:v1:[a-f0-9]{64}$/);
const candidateBatchRefSchema = z.string().regex(/^skcb:v1:[a-f0-9]{64}$/);
const candidateReceiptRefSchema = z.string().regex(/^skcr:v1:[a-f0-9]{64}$/);
const feedbackBatchRefSchema = z.string().regex(/^skfb:v1:[a-f0-9]{64}$/);
const feedbackReceiptRefSchema = z.string().regex(/^skfr:v1:[a-f0-9]{64}$/);
const nullableCountSchema = z.number().int().nonnegative().nullable();
const nullableDurationSchema = z.number().nonnegative().nullable();

const capabilityDecisionSchema = z
	.object({
		decision: z.enum(["pending", "go", "iterate", "stop"]),
		evidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
	})
	.strict();

export const nightworkersSecurityIntelligenceIntegrityRunSchema = z
	.object({
		taskRef: securityIntelligenceOpaqueRefSchema,
		taskRevisionSnapshotId: securityIntelligenceOpaqueRefSchema,
		taskRevisionSnapshotDigest: securityIntelligenceSha256DigestSchema,
		runRef: securityIntelligenceOpaqueRefSchema,
		evidenceSubjectRef: securityIntelligenceOpaqueRefSchema,
		primaryLane: z.enum(["native_api", "codex"]),
		secondaryLane: z
			.object({
				lane: z.enum(["native_api", "codex"]),
				adapterContractVerified: z.boolean(),
			})
			.strict(),
		projectRef: securityIntelligenceOpaqueRefSchema,
		baseRevision: securityIntelligenceRevisionSchema,
		sourceRevision: securityIntelligenceRevisionSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
		preBundleRef: bundleRefSchema,
		preAssessmentRef: assessmentRefSchema,
		securityContractRef: securityContractRefSchema,
		postBundleRef: bundleRefSchema,
		postAssessmentRef: assessmentRefSchema,
		finalJudgmentRef: finalJudgmentRefSchema,
		selectedVerificationRefs:
			securityIntelligenceCanonicalOpaqueRefsSchema.min(1),
		selectedEvidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema.min(1),
		unresolvedEvidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		evidenceResolution: z.enum([
			"resolved",
			"partially_resolved",
			"unresolved",
		]),
		outcome: securityIntelligenceOutcomeSchema,
		lifecycle: z
			.object({
				preAssessmentVerified: z.boolean(),
				securityContractAdopted: z.boolean(),
				postAssessmentVerified: z.boolean(),
				finalJudgmentStored: z.boolean(),
			})
			.strict(),
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.primaryLane === value.secondaryLane.lane) {
			addIssue(ctx, ["secondaryLane", "lane"], "secondary_lane_not_distinct");
		}
		if (value.baseRevision === value.sourceRevision) {
			addIssue(ctx, ["sourceRevision"], "revision_roles_not_distinct");
		}
		if (value.preAssessmentRef === value.postAssessmentRef) {
			addIssue(ctx, ["postAssessmentRef"], "assessment_lifecycle_not_distinct");
		}
		if (value.preBundleRef === value.postBundleRef) {
			addIssue(ctx, ["postBundleRef"], "bundle_lifecycle_not_distinct");
		}
		const selected = new Set(value.selectedEvidenceRefs);
		if (value.unresolvedEvidenceRefs.some((ref) => !selected.has(ref))) {
			addIssue(ctx, ["unresolvedEvidenceRefs"], "unselected_evidence_ref");
		}
		const unresolved = value.unresolvedEvidenceRefs.length;
		const expected =
			unresolved === 0
				? "resolved"
				: unresolved === value.selectedEvidenceRefs.length
					? "unresolved"
					: "partially_resolved";
		if (value.evidenceResolution !== expected) {
			addIssue(ctx, ["evidenceResolution"], "evidence_resolution_mismatch");
		}
	});

const shadowSmokeSchema = z
	.object({
		status: z.enum(["not_run", "completed", "stopped"]),
		candidateBatchRef: candidateBatchRefSchema.nullable(),
		candidateReceiptRef: candidateReceiptRefSchema.nullable(),
		feedbackBatchRef: feedbackBatchRefSchema.nullable(),
		feedbackReceiptRef: feedbackReceiptRefSchema.nullable(),
		checks: z
			.object({
				replayAccepted: z.boolean(),
				idempotencyConflictRejected: z.boolean(),
				outageRetriedWithoutLoss: z.boolean(),
				duplicateFeedbackReplayed: z.boolean(),
				crossScopeTokenRejected: z.boolean(),
				knowledgeStateUnchanged: z.boolean(),
				codingBehaviorUnaffected: z.boolean(),
			})
			.strict(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.status !== "completed") return;
		const refs = [
			value.candidateBatchRef,
			value.candidateReceiptRef,
			value.feedbackBatchRef,
			value.feedbackReceiptRef,
		];
		if (refs.some((ref) => ref === null)) {
			addIssue(ctx, [], "shadow_evidence_incomplete");
		}
		if (Object.values(value.checks).some((check) => !check)) {
			addIssue(ctx, ["checks"], "shadow_check_incomplete");
		}
	});

export const nightworkersSecurityIntelligenceIntegrityEvidenceSchema = z
	.object({
		schemaVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_INTEGRITY_EVIDENCE_VERSION,
		),
		smokeId: securityIntelligenceOpaqueRefSchema,
		status: z.enum(["not_started", "in_progress", "completed", "stopped"]),
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		generatedAt: securityIntelligenceTimestampSchema.nullable(),
		preflight: z
			.object({
				repositoryCommits: z
					.object({
						vulnWorkbench: commitSchema.nullable(),
						nightWorkers: commitSchema.nullable(),
						contextStill: commitSchema.nullable(),
					})
					.strict(),
				cleanWorkingTrees: z
					.object({
						vulnWorkbench: z.boolean(),
						nightWorkers: z.boolean(),
						contextStill: z.boolean(),
					})
					.strict(),
				crossRepositoryFixtureDigests: z
					.object({
						identityMapping: securityIntelligenceSha256DigestSchema.nullable(),
						assessmentBundle: securityIntelligenceSha256DigestSchema.nullable(),
						scanBindingCore: securityIntelligenceSha256DigestSchema.nullable(),
						candidateBatch: securityIntelligenceSha256DigestSchema.nullable(),
						feedbackBatch: securityIntelligenceSha256DigestSchema.nullable(),
					})
					.strict(),
				declarationScope: z.enum([
					"verified_repository_declarations",
					"transport_integrity_only",
				]),
			})
			.strict(),
		configuration: z
			.object({
				vulnWorkbenchEndpointDefaultEnabled: z.literal(false),
				nightWorkersConsumerDefaultEnabled: z.literal(false),
				postAssessmentDefaultEnabled: z.literal(false),
				candidateIngressDefaultEnabled: z.literal(false),
				feedbackIngressDefaultEnabled: z.literal(false),
				shadowRetrievalDefaultEnabled: z.literal(false),
				allowedProjectCount: z.number().int().min(0).max(1),
			})
			.strict(),
		integrityRun: nightworkersSecurityIntelligenceIntegrityRunSchema.nullable(),
		negativeChecks: z
			.object({
				wrongProjectRejected: z.boolean(),
				wrongRevisionRejected: z.boolean(),
				wrongTargetDigestRejected: z.boolean(),
				wrongEvidenceSubjectRejected: z.boolean(),
				crossRunEvidenceRejected: z.boolean(),
				requiredFailurePresentedAsFailure: z.boolean(),
				unavailablePresentedAsUnavailable: z.boolean(),
			})
			.strict(),
		shadowSmoke: shadowSmokeSchema,
		observations: z
			.object({
				assessmentBuildLatencyMs: nullableDurationSchema,
				endpointRequestCount: nullableCountSchema,
				unexpectedEndpointErrorCount: nullableCountSchema,
				payloadSizeBytes: nullableCountSchema,
			})
			.strict(),
		privacyAssertions: z
			.object({
				noSourceBody: z.boolean(),
				noSecret: z.boolean(),
				noAbsoluteFilesystemPath: z.boolean(),
			})
			.strict(),
		rollbackDrill: z
			.object({
				nightWorkersConsumerDisabled: z.boolean(),
				postAssessmentDisabled: z.boolean(),
				candidateDispatcherDisabled: z.boolean(),
				feedbackDispatcherDisabled: z.boolean(),
				vulnWorkbenchEndpointDisabled: z.boolean(),
				existingScanApiUnaffected: z.boolean(),
				normalRunUnaffected: z.boolean(),
			})
			.strict(),
		capabilityDecisions: z
			.object({
				assessmentConsumer: capabilityDecisionSchema,
				postAssessmentGrant: capabilityDecisionSchema,
				candidateExport: capabilityDecisionSchema,
				feedbackExport: capabilityDecisionSchema,
				shadowRetrieval: capabilityDecisionSchema,
			})
			.strict(),
		defaultActivationAuthorized: z.literal(false),
		stopReasonCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.status === "stopped") {
			if (value.generatedAt === null || value.stopReasonCodes.length === 0) {
				addIssue(ctx, ["stopReasonCodes"], "stop_evidence_incomplete");
			}
			if (hasFalse(value.rollbackDrill)) {
				addIssue(ctx, ["rollbackDrill"], "rollback_incomplete");
			}
			return;
		}
		if (value.status !== "completed") return;
		if (value.generatedAt === null || value.stopReasonCodes.length > 0) {
			addIssue(ctx, ["generatedAt"], "completion_state_invalid");
		}
		if (
			Object.values(value.preflight.repositoryCommits).some(
				(commit) => commit === null,
			) ||
			hasFalse(value.preflight.cleanWorkingTrees) ||
			Object.values(value.preflight.crossRepositoryFixtureDigests).some(
				(digest) => digest === null,
			) ||
			value.configuration.allowedProjectCount !== 1
		) {
			addIssue(ctx, ["preflight"], "preflight_incomplete");
		}
		if (
			value.integrityRun === null ||
			hasFalse(value.integrityRun?.lifecycle ?? {}) ||
			!value.integrityRun?.secondaryLane.adapterContractVerified ||
			value.integrityRun?.evidenceResolution !== "resolved"
		) {
			addIssue(ctx, ["integrityRun"], "integrity_run_incomplete");
		}
		if (hasFalse(value.negativeChecks)) {
			addIssue(ctx, ["negativeChecks"], "negative_check_incomplete");
		}
		if (value.shadowSmoke.status !== "completed") {
			addIssue(ctx, ["shadowSmoke", "status"], "shadow_smoke_incomplete");
		}
		if (Object.values(value.observations).some((item) => item === null)) {
			addIssue(ctx, ["observations"], "observations_incomplete");
		} else if (value.observations.unexpectedEndpointErrorCount !== 0) {
			addIssue(
				ctx,
				["observations", "unexpectedEndpointErrorCount"],
				"endpoint_error_requires_stop",
			);
		}
		if (hasFalse(value.privacyAssertions)) {
			addIssue(ctx, ["privacyAssertions"], "privacy_assertion_incomplete");
		}
		if (hasFalse(value.rollbackDrill)) {
			addIssue(ctx, ["rollbackDrill"], "rollback_incomplete");
		}
		for (const [name, decision] of Object.entries(value.capabilityDecisions)) {
			if (
				decision.decision === "pending" ||
				decision.evidenceRefs.length === 0
			) {
				addIssue(
					ctx,
					["capabilityDecisions", name],
					"capability_decision_incomplete",
				);
			}
		}
	});

export type NightworkersSecurityIntelligenceIntegrityEvidence = z.infer<
	typeof nightworkersSecurityIntelligenceIntegrityEvidenceSchema
>;

function hasFalse(value: Record<string, boolean>): boolean {
	return Object.values(value).some((item) => !item);
}

function addIssue(
	ctx: z.RefinementCtx,
	path: PropertyKey[],
	code: string,
): void {
	ctx.addIssue({
		code: "custom",
		path,
		message: `security_intelligence:integrity_${code}`,
	});
}
