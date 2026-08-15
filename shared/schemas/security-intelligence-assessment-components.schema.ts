import { z } from "zod";

export const securityIntelligenceOpaqueRefSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
export const securityIntelligenceSha256DigestSchema = z
	.string()
	.regex(/^sha256:[a-f0-9]{64}$/);
export const securityIntelligenceRevisionSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/,
		"security_intelligence:revision_format_invalid",
	)
	.refine(
		(value) =>
			!value.includes("://") &&
			!/^\p{ASCII}:\//u.test(value) &&
			!value.startsWith("/") &&
			!value.endsWith("/") &&
			value
				.split("/")
				.every(
					(segment) => segment !== "" && segment !== "." && segment !== "..",
				),
		"security_intelligence:non_canonical_revision",
	);
export const securityIntelligenceProducerVersionSchema = z
	.string()
	.regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/);
export const securityIntelligenceTimestampSchema = z
	.string()
	.datetime({ offset: false, precision: 3 });

const reasonCodeSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const localFilesystemPathPattern =
	/(?:file:\/\/\/|\/(?:Users|app|etc|home|mnt|opt|private|root|srv|tmp|usr|var|Volumes|workspace)\/|[a-z]:[\\/]|\\\\[^\\\s]+\\)/i;
const credentialAssignmentPattern =
	/["']?(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|cookie|password|private[_-]?key|refresh[_-]?token|secret|token)["']?\s*[:=]\s*["']?(?!(?:false|null|none)(?:\b|["']))[^\s,"'}]+/i;

function containsControlCharacter(value: string): boolean {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}

export const securityIntelligenceSafeTextSchema = z
	.string()
	.min(1)
	.max(2_000)
	.refine(
		(value) => value.normalize("NFC") === value,
		"security_intelligence:non_canonical_unicode",
	)
	.refine(
		(value) => value === value.trim(),
		"security_intelligence:non_canonical_whitespace",
	)
	.refine(
		(value) => !containsControlCharacter(value),
		"security_intelligence:control_character_forbidden",
	)
	.refine(
		(value) => !localFilesystemPathPattern.test(value),
		"security_intelligence:absolute_local_path_forbidden",
	)
	.refine(
		(value) => !credentialAssignmentPattern.test(value),
		"security_intelligence:credential_shaped_text_forbidden",
	);

export const securityIntelligenceRepositoryPathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine((value) => {
		const segments = value.split("/");
		return (
			value.normalize("NFC") === value &&
			!value.startsWith("/") &&
			!value.startsWith("\\\\") &&
			!/^[a-z][a-z0-9+.-]*:/i.test(value) &&
			!value.includes("\\") &&
			!containsControlCharacter(value) &&
			segments.every(
				(segment) =>
					segment !== "" &&
					segment !== "." &&
					segment !== ".." &&
					segment === segment.trim(),
			)
		);
	}, "security_intelligence:repository_relative_path_required");

export function isCanonicalSecurityIntelligenceOrder(
	values: readonly string[],
): boolean {
	return values.every(
		(value, index) => index === 0 || values[index - 1] < value,
	);
}

function canonicalStringArraySchema<T extends z.ZodType<string>>(
	itemSchema: T,
	maxLength: number,
) {
	return z
		.array(itemSchema)
		.max(maxLength)
		.superRefine((values, ctx) => {
			if (!isCanonicalSecurityIntelligenceOrder(values)) {
				ctx.addIssue({
					code: "custom",
					message:
						"security_intelligence:array_must_be_unique_and_canonically_sorted",
				});
			}
		});
}

export const securityIntelligenceCanonicalOpaqueRefsSchema =
	canonicalStringArraySchema(securityIntelligenceOpaqueRefSchema, 500);
export const securityIntelligenceCanonicalSafeTextsSchema =
	canonicalStringArraySchema(securityIntelligenceSafeTextSchema, 200);
export const securityIntelligenceCanonicalReasonCodesSchema =
	canonicalStringArraySchema(reasonCodeSchema, 200);

export const securityIntelligenceTargetKindSchema = z.enum([
	"commit",
	"diff",
	"snapshot",
]);

export const securityIntelligenceTargetSchema = z
	.object({
		kind: securityIntelligenceTargetKindSchema,
		sourceRevision: securityIntelligenceRevisionSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
		baseRevision: securityIntelligenceRevisionSchema.optional(),
		headRevision: securityIntelligenceRevisionSchema.optional(),
		baseTargetDigest: securityIntelligenceSha256DigestSchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (
			(value.baseRevision === undefined) !==
			(value.headRevision === undefined)
		) {
			ctx.addIssue({
				code: "custom",
				path: [
					value.baseRevision === undefined ? "baseRevision" : "headRevision",
				],
				message: "security_intelligence:base_and_head_revision_must_be_paired",
			});
		}
		if (
			value.baseTargetDigest !== undefined &&
			value.baseRevision === undefined
		) {
			ctx.addIssue({
				code: "custom",
				path: ["baseTargetDigest"],
				message:
					"security_intelligence:base_target_digest_requires_base_revision",
			});
		}
		if (
			value.kind !== "diff" &&
			(value.baseRevision !== undefined ||
				value.headRevision !== undefined ||
				value.baseTargetDigest !== undefined)
		) {
			ctx.addIssue({
				code: "custom",
				message: "security_intelligence:comparison_fields_require_diff_target",
			});
		}
		if (
			value.kind === "diff" &&
			value.headRevision !== undefined &&
			value.sourceRevision !== value.headRevision
		) {
			ctx.addIssue({
				code: "custom",
				path: ["sourceRevision"],
				message: "security_intelligence:source_revision_must_match_diff_head",
			});
		}
	});

export const securityIntelligenceClaimOriginSchema = z.enum(
	["observed", "inferred"],
	{ error: "security_intelligence:claim_origin_invalid" },
);

export const securityIntelligenceClaimSchema = z
	.object({
		claimRef: securityIntelligenceOpaqueRefSchema,
		origin: securityIntelligenceClaimOriginSchema,
		subject: securityIntelligenceSafeTextSchema,
		predicate: reasonCodeSchema,
		summary: securityIntelligenceSafeTextSchema,
		confidence: z.enum(["high", "medium", "low"]),
		evidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.evidenceRefs.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceRefs"],
				message: "security_intelligence:claim_evidence_required",
			});
		}
	});

export const securityIntelligenceVerificationStatusSchema = z.enum([
	"tested",
	"failed",
	"unavailable",
	"not_applicable",
	"not_tested",
]);

export const securityIntelligenceVerificationSchema = z
	.object({
		verificationRef: securityIntelligenceOpaqueRefSchema,
		capabilityRef: securityIntelligenceOpaqueRefSchema,
		required: z.boolean(),
		status: securityIntelligenceVerificationStatusSchema,
		reasonCode: reasonCodeSchema,
		summary: securityIntelligenceSafeTextSchema,
		evidenceRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
		findingRefs: securityIntelligenceCanonicalOpaqueRefsSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.status === "tested" && value.evidenceRefs.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["evidenceRefs"],
				message: "security_intelligence:tested_evidence_required",
			});
		}
		if (value.status !== "tested" && value.findingRefs.length > 0) {
			ctx.addIssue({
				code: "custom",
				path: ["findingRefs"],
				message: "security_intelligence:findings_require_tested_verification",
			});
		}
		if (value.required && value.status === "not_applicable") {
			ctx.addIssue({
				code: "custom",
				path: ["status"],
				message:
					"security_intelligence:required_verification_cannot_be_not_applicable",
			});
		}
	});

export const securityIntelligenceEvidenceKindSchema = z.enum([
	"tool_run",
	"scan_artifact",
	"finding",
	"report",
	"application_model",
	"source_location",
]);

export const securityIntelligenceEvidenceRefSchema = z
	.object({
		ref: securityIntelligenceOpaqueRefSchema,
		kind: securityIntelligenceEvidenceKindSchema,
		targetRole: z.enum(["assessment_target", "base_target"]),
		scanRunRef: securityIntelligenceOpaqueRefSchema,
		targetDigest: securityIntelligenceSha256DigestSchema,
		digest: securityIntelligenceSha256DigestSchema,
		location: z
			.object({
				path: securityIntelligenceRepositoryPathSchema,
				startLine: z.number().int().positive().optional(),
				endLine: z.number().int().positive().optional(),
			})
			.strict()
			.superRefine((value, ctx) => {
				if ((value.startLine === undefined) !== (value.endLine === undefined)) {
					ctx.addIssue({
						code: "custom",
						path: [value.startLine === undefined ? "startLine" : "endLine"],
						message: "security_intelligence:evidence_line_range_must_be_paired",
					});
				}
				if (
					value.startLine !== undefined &&
					value.endLine !== undefined &&
					value.endLine < value.startLine
				) {
					ctx.addIssue({
						code: "custom",
						path: ["endLine"],
						message: "security_intelligence:evidence_line_range_invalid",
					});
				}
			})
			.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.kind === "source_location" && value.location === undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["location"],
				message: "security_intelligence:source_location_requires_location",
			});
		}
	});

export const securityIntelligenceOutcomeSchema = z.enum(
	["findings_observed", "no_findings_observed", "inconclusive", "unavailable"],
	{ error: "security_intelligence:outcome_invalid" },
);
