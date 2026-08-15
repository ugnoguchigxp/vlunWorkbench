import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalStringifySecurityIntelligenceValue } from "../security-intelligence-assessment-contract";
import { integrationErrorCodeSchema } from "./nightworkers-security-scan-integration.schema";
import {
	type SecurityIntelligenceAssessmentV1,
	securityIntelligenceAssessmentV1Schema,
} from "./security-intelligence-assessment.schema";
import {
	securityIntelligenceCanonicalReasonCodesSchema,
	securityIntelligenceOpaqueRefSchema,
	securityIntelligenceSafeTextSchema,
	securityIntelligenceTargetSchema,
} from "./security-intelligence-assessment-components.schema";

export const NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION = 1 as const;

const bundleRefSchema = z.string().regex(/^sib:v1:[a-f0-9]{64}$/);
const requestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,64}$/);
const projectRefSchema = securityIntelligenceOpaqueRefSchema.refine(
	(value) => value.startsWith("project:"),
	"security_intelligence:nightworkers_project_ref_invalid",
);
const scanRunRefSchema = securityIntelligenceOpaqueRefSchema.refine(
	(value) => value.startsWith("scan-run:"),
	"security_intelligence:nightworkers_scan_run_ref_invalid",
);
const safeErrorDetailsSchema = z
	.record(
		z.string().max(64),
		z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]),
	)
	.optional();

export const nightworkersAuthorizationShadowStateSchema = z.discriminatedUnion(
	"status",
	[
		z
			.object({
				status: z.literal("disabled"),
				reasonCode: z.literal("authorization_shadow_disabled"),
			})
			.strict(),
		z
			.object({
				status: z.literal("unavailable"),
				reasonCode: z.literal("authorization_shadow_unavailable"),
			})
			.strict(),
		z
			.object({
				status: z.literal("available"),
				assessment: securityIntelligenceAssessmentV1Schema,
			})
			.strict(),
	],
);
export type NightworkersAuthorizationShadowState = z.infer<
	typeof nightworkersAuthorizationShadowStateSchema
>;

export const nightworkersSecurityIntelligenceBundleSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		bundleRef: bundleRefSchema,
		projectRef: projectRefSchema,
		scanRunRef: scanRunRefSchema,
		target: securityIntelligenceTargetSchema,
		dependencyAssessment: securityIntelligenceAssessmentV1Schema,
		authorizationShadow: nightworkersAuthorizationShadowStateSchema,
		limitationCodes: securityIntelligenceCanonicalReasonCodesSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		assertAssessmentBinding({
			assessment: value.dependencyAssessment,
			projectRef: value.projectRef,
			scanRunRef: value.scanRunRef,
			target: value.target,
			path: ["dependencyAssessment"],
			ctx,
		});
		if (value.dependencyAssessment.target.kind !== "diff") {
			ctx.addIssue({
				code: "custom",
				path: ["dependencyAssessment", "target", "kind"],
				message: "security_intelligence:nightworkers_dependency_diff_required",
			});
		}
		if (value.authorizationShadow.status === "available") {
			assertAssessmentBinding({
				assessment: value.authorizationShadow.assessment,
				projectRef: value.projectRef,
				scanRunRef: value.scanRunRef,
				target: value.target,
				path: ["authorizationShadow", "assessment"],
				ctx,
			});
		}
		const expectedLimitation =
			value.authorizationShadow.status === "disabled"
				? "authorization_shadow_disabled"
				: value.authorizationShadow.status === "unavailable"
					? "authorization_shadow_unavailable"
					: null;
		if (
			expectedLimitation &&
			!value.limitationCodes.includes(expectedLimitation)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["limitationCodes"],
				message:
					"security_intelligence:nightworkers_authorization_state_limitation_required",
			});
		}
	});
export type NightworkersSecurityIntelligenceBundle = z.infer<
	typeof nightworkersSecurityIntelligenceBundleSchema
>;

export const nightworkersSecurityIntelligenceSuccessEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		data: nightworkersSecurityIntelligenceBundleSchema,
	})
	.strict();

export const nightworkersSecurityIntelligenceErrorCodeSchema = z.union([
	integrationErrorCodeSchema,
	z.enum(["assessment_not_ready", "assessment_unavailable"]),
]);
export type NightworkersSecurityIntelligenceErrorCode = z.infer<
	typeof nightworkersSecurityIntelligenceErrorCodeSchema
>;

export const nightworkersSecurityIntelligenceErrorEnvelopeSchema = z
	.object({
		contractVersion: z.literal(
			NIGHTWORKERS_SECURITY_INTELLIGENCE_CONTRACT_VERSION,
		),
		requestId: requestIdSchema,
		error: z
			.object({
				code: nightworkersSecurityIntelligenceErrorCodeSchema,
				message: securityIntelligenceSafeTextSchema,
				retryable: z.boolean(),
				details: safeErrorDetailsSchema,
			})
			.strict(),
	})
	.strict();

export function deriveNightworkersSecurityIntelligenceBundleRef(
	bundle: Omit<NightworkersSecurityIntelligenceBundle, "bundleRef">,
): `sib:v1:${string}` {
	return `sib:v1:${createHash("sha256")
		.update(canonicalStringifySecurityIntelligenceValue(bundle))
		.digest("hex")}`;
}

export function parseNightworkersSecurityIntelligenceBundle(
	input: unknown,
): NightworkersSecurityIntelligenceBundle {
	const parsed = nightworkersSecurityIntelligenceBundleSchema.parse(input);
	const { bundleRef: _bundleRef, ...semantic } = parsed;
	if (
		deriveNightworkersSecurityIntelligenceBundleRef(semantic) !==
		parsed.bundleRef
	) {
		throw new Error(
			"security_intelligence:nightworkers_bundle_digest_mismatch",
		);
	}
	return parsed;
}

function assertAssessmentBinding(params: {
	assessment: SecurityIntelligenceAssessmentV1;
	projectRef: string;
	scanRunRef: string;
	target: SecurityIntelligenceAssessmentV1["target"];
	path: Array<string | number>;
	ctx: z.RefinementCtx;
}): void {
	const { assessment, target } = params;
	if (
		assessment.projectRef !== params.projectRef ||
		assessment.source.scanRunRef !== params.scanRunRef ||
		canonicalStringifySecurityIntelligenceValue(assessment.target) !==
			canonicalStringifySecurityIntelligenceValue(target)
	) {
		params.ctx.addIssue({
			code: "custom",
			path: params.path,
			message: "security_intelligence:nightworkers_assessment_binding_mismatch",
		});
	}
}
