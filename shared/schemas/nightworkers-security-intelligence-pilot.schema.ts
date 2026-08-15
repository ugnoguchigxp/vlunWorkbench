import { z } from "zod";
import {
	securityIntelligenceCanonicalOpaqueRefsSchema,
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceOutcomeSchema,
	securityIntelligenceRevisionSchema,
	securityIntelligenceSha256DigestSchema,
	securityIntelligenceTimestampSchema,
} from "./security-intelligence-assessment-components.schema";
import { NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION } from "./nightworkers-security-intelligence.schema";

export const NIGHTWORKERS_SECURITY_INTELLIGENCE_PILOT_SCHEMA_VERSION =
	"security-intelligence-nightworkers-pilot-evidence-v1" as const;

const nullableCount = z.number().int().nonnegative().nullable();
const nullableRate = z.number().min(0).max(1).nullable();
const nullableDuration = z.number().nonnegative().nullable();
const bundleRefSchema = z.string().regex(/^sib:v1:[a-f0-9]{64}$/);
const assessmentRefSchema = z.string().regex(/^sia:v1:[a-f0-9]{64}$/);

export const nightworkersSecurityIntelligencePilotPairSchema = z
	.object({
		taskRef: securityIntelligenceOpaqueRefSchema,
		baselineRunRef: securityIntelligenceOpaqueRefSchema,
		assessmentRunRef: securityIntelligenceOpaqueRefSchema,
		bundleRef: bundleRefSchema,
		dependencyAssessmentRef: assessmentRefSchema,
		authorizationAssessmentRef: assessmentRefSchema.nullable(),
		projectRef: securityIntelligenceOpaqueRefSchema,
		sourceRevision: securityIntelligenceRevisionSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
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
		operatorAction: z.enum([
			"none",
			"investigated",
			"remediated",
			"accepted_risk",
			"deferred",
		]),
		baselineTimeToEvidenceSeconds: z.number().nonnegative(),
		assessmentTimeToEvidenceSeconds: z.number().nonnegative(),
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.baselineRunRef === value.assessmentRunRef) {
			ctx.addIssue({
				code: "custom",
				path: ["assessmentRunRef"],
				message: "security_intelligence:pilot_run_pair_not_independent",
			});
		}
		const selected = new Set(value.selectedEvidenceRefs);
		if (value.unresolvedEvidenceRefs.some((ref) => !selected.has(ref))) {
			ctx.addIssue({
				code: "custom",
				path: ["unresolvedEvidenceRefs"],
				message: "security_intelligence:pilot_unselected_evidence_ref",
			});
		}
		const unresolvedCount = value.unresolvedEvidenceRefs.length;
		const selectedCount = value.selectedEvidenceRefs.length;
		const expectedResolution =
			unresolvedCount === 0
				? "resolved"
				: unresolvedCount === selectedCount
					? "unresolved"
					: "partially_resolved";
		if (value.evidenceResolution !== expectedResolution) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceResolution"],
				message: "security_intelligence:pilot_evidence_resolution_mismatch",
			});
		}
	});

export const nightworkersSecurityIntelligencePilotEvidenceSchema = z
	.object({
		schemaVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_PILOT_SCHEMA_VERSION,
		),
		pilotId: securityIntelligenceOpaqueRefSchema,
		status: z.enum(["not_started", "in_progress", "completed", "stopped"]),
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		generatedAt: securityIntelligenceTimestampSchema.nullable(),
		configuration: z
			.object({
				vulnWorkbenchEndpointDefaultEnabled: z.literal(false),
				nightWorkersConsumerDefaultEnabled: z.literal(false),
				authorizationShadowDefaultEnabled: z.literal(false),
				allowedProjectCount: z.number().int().nonnegative(),
			})
			.strict(),
		sample: z
			.object({
				requiredValidPairCount: z.number().int().min(10),
				pairs: z.array(nightworkersSecurityIntelligencePilotPairSchema),
				invalidPairs: z.array(
					z
						.object({
							taskRef: securityIntelligenceOpaqueRefSchema,
							reasonCode: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
						})
						.strict(),
				),
			})
			.strict(),
		metrics: z
			.object({
				wrongProjectOrRevisionBindingCount: nullableCount,
				unresolvedEvidenceRefCount: nullableCount,
				secretOrAbsolutePathLeakCount: nullableCount,
				requiredFailureShownAsSuccessCount: nullableCount,
				contractParseFailureCount: nullableCount,
				evidenceResolutionRate: nullableRate,
				operatorActionRate: nullableRate,
				baselineTimeToEvidenceMedianSeconds: nullableDuration,
				assessmentTimeToEvidenceMedianSeconds: nullableDuration,
				assessmentBuildLatencyP50Ms: nullableDuration,
				assessmentBuildLatencyP95Ms: nullableDuration,
				endpointErrorRate: nullableRate,
				payloadSizeP95Bytes: nullableDuration,
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
				vulnWorkbenchEndpointDisabled: z.boolean(),
				existingScanApiUnaffected: z.boolean(),
			})
			.strict(),
		stopReasonCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		for (const [field, code] of [
			["taskRef", "task_ref"],
			["baselineRunRef", "baseline_run_ref"],
			["assessmentRunRef", "assessment_run_ref"],
			["bundleRef", "bundle_ref"],
			["dependencyAssessmentRef", "dependency_assessment_ref"],
		] as const) {
			if (
				new Set(value.sample.pairs.map((pair) => pair[field])).size !==
				value.sample.pairs.length
			) {
				ctx.addIssue({
					code: "custom",
					path: ["sample", "pairs"],
					message: `security_intelligence:pilot_duplicate_${code}`,
				});
			}
		}
		const authorizationAssessmentRefs = value.sample.pairs.flatMap((pair) =>
			pair.authorizationAssessmentRef === null
				? []
				: [pair.authorizationAssessmentRef],
		);
		if (
			new Set(authorizationAssessmentRefs).size !==
			authorizationAssessmentRefs.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["sample", "pairs"],
				message:
					"security_intelligence:pilot_duplicate_authorization_assessment_ref",
			});
		}
		if (value.sample.invalidPairs.length > 0 && value.status === "completed") {
			ctx.addIssue({
				code: "custom",
				path: ["sample", "invalidPairs"],
				message: "security_intelligence:pilot_integrity_incident_requires_stop",
			});
		}
		if (value.status === "stopped") {
			if (value.generatedAt === null || value.stopReasonCodes.length === 0) {
				ctx.addIssue({
					code: "custom",
					path: ["stopReasonCodes"],
					message: "security_intelligence:pilot_stop_evidence_incomplete",
				});
			}
			if (Object.values(value.rollbackDrill).some((assertion) => !assertion)) {
				ctx.addIssue({
					code: "custom",
					path: ["rollbackDrill"],
					message: "security_intelligence:pilot_rollback_incomplete",
				});
			}
			return;
		}
		if (value.status !== "completed") return;
		if (value.stopReasonCodes.length > 0) {
			ctx.addIssue({
				code: "custom",
				path: ["stopReasonCodes"],
				message: "security_intelligence:pilot_completed_with_stop_reason",
			});
		}
		if (value.sample.pairs.length < value.sample.requiredValidPairCount) {
			ctx.addIssue({
				code: "custom",
				path: ["sample", "pairs"],
				message: "security_intelligence:pilot_sample_incomplete",
			});
			return;
		}
		if (
			value.generatedAt === null ||
			Object.values(value.metrics).some((metric) => metric === null)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["metrics"],
				message: "security_intelligence:pilot_metrics_incomplete",
			});
			return;
		}
		const integrityMetrics = [
			value.metrics.wrongProjectOrRevisionBindingCount,
			value.metrics.unresolvedEvidenceRefCount,
			value.metrics.secretOrAbsolutePathLeakCount,
			value.metrics.requiredFailureShownAsSuccessCount,
			value.metrics.contractParseFailureCount,
		];
		if (
			integrityMetrics.some(
				(metric) => typeof metric === "number" && metric > 0,
			)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["metrics"],
				message: "security_intelligence:pilot_integrity_incident_requires_stop",
			});
		}
		if (
			Object.values(value.privacyAssertions).some((assertion) => !assertion)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["privacyAssertions"],
				message: "security_intelligence:pilot_privacy_assertion_incomplete",
			});
		}
		if (Object.values(value.rollbackDrill).some((assertion) => !assertion)) {
			ctx.addIssue({
				code: "custom",
				path: ["rollbackDrill"],
				message: "security_intelligence:pilot_rollback_incomplete",
			});
		}
		const pairCount = value.sample.pairs.length;
		const selectedEvidenceCount = value.sample.pairs.reduce(
			(total, pair) => total + pair.selectedEvidenceRefs.length,
			0,
		);
		const unresolvedEvidenceCount = value.sample.pairs.reduce(
			(total, pair) => total + pair.unresolvedEvidenceRefs.length,
			0,
		);
		const expectedMetrics = {
			unresolvedEvidenceRefCount: unresolvedEvidenceCount,
			evidenceResolutionRate:
				(selectedEvidenceCount - unresolvedEvidenceCount) /
				selectedEvidenceCount,
			operatorActionRate:
				value.sample.pairs.filter((pair) => pair.operatorAction !== "none")
					.length / pairCount,
			baselineTimeToEvidenceMedianSeconds: median(
				value.sample.pairs.map((pair) => pair.baselineTimeToEvidenceSeconds),
			),
			assessmentTimeToEvidenceMedianSeconds: median(
				value.sample.pairs.map((pair) => pair.assessmentTimeToEvidenceSeconds),
			),
		};
		for (const [metric, expected] of Object.entries(expectedMetrics)) {
			const actual = value.metrics[metric as keyof typeof expectedMetrics];
			if (typeof actual !== "number" || !approximatelyEqual(actual, expected)) {
				ctx.addIssue({
					code: "custom",
					path: ["metrics", metric],
					message: "security_intelligence:pilot_metric_mismatch",
				});
			}
		}
	});

export type NightworkersSecurityIntelligencePilotEvidence = z.infer<
	typeof nightworkersSecurityIntelligencePilotEvidenceSchema
>;

function median(values: number[]): number {
	const ordered = [...values].sort((left, right) => left - right);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 0
		? (ordered[middle - 1] + ordered[middle]) / 2
		: ordered[middle];
}

function approximatelyEqual(left: number, right: number): boolean {
	return Math.abs(left - right) <= 1e-9;
}
