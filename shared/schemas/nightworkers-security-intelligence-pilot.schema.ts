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

export const nightworkersSecurityIntelligencePilotPairSchema = z
	.object({
		taskRef: securityIntelligenceOpaqueRefSchema,
		baselineRunRef: securityIntelligenceOpaqueRefSchema,
		assessmentRunRef: securityIntelligenceOpaqueRefSchema,
		projectRef: securityIntelligenceOpaqueRefSchema,
		sourceRevision: securityIntelligenceRevisionSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
		selectedVerificationRefs:
			securityIntelligenceCanonicalOpaqueRefsSchema.min(1),
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
	.strict();

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
		if (value.sample.invalidPairs.length > 0 && value.status === "completed") {
			ctx.addIssue({
				code: "custom",
				path: ["sample", "invalidPairs"],
				message: "security_intelligence:pilot_integrity_incident_requires_stop",
			});
		}
		if (value.status !== "completed") return;
		if (value.sample.pairs.length < value.sample.requiredValidPairCount) {
			ctx.addIssue({
				code: "custom",
				path: ["sample", "pairs"],
				message: "security_intelligence:pilot_sample_incomplete",
			});
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
	});

export type NightworkersSecurityIntelligencePilotEvidence = z.infer<
	typeof nightworkersSecurityIntelligencePilotEvidenceSchema
>;
