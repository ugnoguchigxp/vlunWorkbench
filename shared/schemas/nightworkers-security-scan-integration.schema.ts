import { z } from "zod";

export const NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION = 1 as const;

export const nightworkersIntegrationScopeSchema = z.enum([
	"nightworkers:security-scan:read",
	"nightworkers:security-scan:write",
	"nightworkers:security-report:read",
	"nightworkers:security-report:write",
]);
export type NightworkersIntegrationScope = z.infer<
	typeof nightworkersIntegrationScopeSchema
>;

export const integrationScanPresetIdSchema = z.enum([
	"quick",
	"standard",
	"deep",
]);
export type IntegrationScanPresetId = z.infer<
	typeof integrationScanPresetIdSchema
>;

export const integrationTargetKindSchema = z.enum(["working_tree", "full"]);
export type IntegrationTargetKind = z.infer<typeof integrationTargetKindSchema>;

export const integrationScanSelectionSchema = z.discriminatedUnion("mode", [
	z
		.object({
			mode: z.literal("preset"),
			presetId: integrationScanPresetIdSchema,
		})
		.strict(),
	z
		.object({
			mode: z.literal("custom"),
			profileRef: z.string().trim().min(1).max(128),
		})
		.strict(),
]);
export type IntegrationScanSelection = z.infer<
	typeof integrationScanSelectionSchema
>;

export const integrationTargetSchema = z
	.object({ kind: integrationTargetKindSchema })
	.strict();
export type IntegrationTarget = z.infer<typeof integrationTargetSchema>;

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const opaqueRefSchema = z.string().min(1).max(256);
const timestampSchema = z.string().datetime();
const nullableTimestampSchema = timestampSchema.nullable();
const projectPathSchema = z.string().min(1).max(4096);

export const integrationSeveritySchema = z.enum([
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
]);
export type IntegrationSeverity = z.infer<typeof integrationSeveritySchema>;

export const integrationExecutionStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
]);
export type IntegrationExecutionStatus = z.infer<
	typeof integrationExecutionStatusSchema
>;

export const integrationSecurityOutcomeSchema = z.enum([
	"findings_present",
	"no_findings",
	"inconclusive",
	"unavailable",
]);
export type IntegrationSecurityOutcome = z.infer<
	typeof integrationSecurityOutcomeSchema
>;

export const integrationReportStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
]);
export type IntegrationReportStatus = z.infer<
	typeof integrationReportStatusSchema
>;

export const integrationErrorCodeSchema = z.enum([
	"integration_unauthorized",
	"integration_scope_denied",
	"rate_limit_exceeded",
	"project_path_denied",
	"project_not_found",
	"project_owner_mismatch",
	"preset_not_found",
	"profile_not_allowed",
	"target_not_supported",
	"preview_expired",
	"target_digest_mismatch",
	"idempotency_conflict",
	"scan_capacity_exceeded",
	"scan_not_found",
	"scan_not_reportable",
	"report_not_found",
	"report_not_ready",
	"report_too_large",
	"invalid_request",
	"provider_temporarily_unavailable",
	"internal_error",
]);
export type IntegrationErrorCode = z.infer<typeof integrationErrorCodeSchema>;

const integrationErrorDetailsSchema = z
	.record(
		z.string().max(64),
		z.union([z.string().max(512), z.number().finite(), z.boolean(), z.null()]),
	)
	.optional();

export const integrationErrorEnvelopeSchema = z
	.object({
		contractVersion: z.literal(NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION),
		requestId: z.string().min(1).max(64),
		error: z
			.object({
				code: integrationErrorCodeSchema,
				message: z.string().min(1).max(1024),
				retryable: z.boolean(),
				details: integrationErrorDetailsSchema,
			})
			.strict(),
	})
	.strict();
export type IntegrationErrorEnvelope = z.infer<
	typeof integrationErrorEnvelopeSchema
>;

export function integrationEnvelopeSchema<T extends z.ZodTypeAny>(
	dataSchema: T,
) {
	return z
		.object({
			contractVersion: z.literal(NIGHTWORKERS_SECURITY_SCAN_CONTRACT_VERSION),
			requestId: z.string().min(1).max(64),
			data: dataSchema,
		})
		.strict();
}

export const integrationCapabilitiesRequestSchema = z
	.object({ projectPath: projectPathSchema })
	.strict();

export const integrationPresetSchema = z
	.object({
		id: integrationScanPresetIdSchema,
		displayName: z.string().min(1).max(128),
		description: z.string().min(1).max(1024),
		recommended: z.boolean(),
		targets: z.array(
			z
				.object({
					kind: integrationTargetKindSchema,
					profileRef: opaqueRefSchema,
					estimatedDurationSeconds: z
						.object({
							min: z.number().int().nonnegative(),
							max: z.number().int().positive(),
						})
						.refine((value) => value.max >= value.min)
						.strict(),
					toolCategories: z.array(z.string().min(1).max(64)).max(32),
					warnings: z.array(z.string().max(512)).max(32),
				})
				.strict(),
		),
	})
	.strict();
export type IntegrationScanPreset = z.infer<typeof integrationPresetSchema>;

export const integrationCapabilitiesSchema = z
	.object({
		provider: z
			.object({
				id: z.literal("vulnworkbench"),
				version: z.string().min(1).max(64),
			})
			.strict(),
		project: z
			.object({
				ref: opaqueRefSchema,
				displayName: z.string().min(1).max(256),
			})
			.strict(),
		presets: z.array(integrationPresetSchema),
		selectableProfiles: z.array(
			z
				.object({
					ref: opaqueRefSchema,
					name: z.string().min(1).max(256),
					description: z.string().max(2048),
					supportedTargets: z.array(integrationTargetKindSchema).min(1),
					requirements: z.array(z.string().max(256)).max(32),
					warnings: z.array(z.string().max(512)).max(32),
				})
				.strict(),
		),
		limits: z
			.object({
				maxConcurrentScansForClient: z.number().int().positive(),
				maxFindingPageSize: z.number().int().positive(),
				maxEventPageSize: z.number().int().positive(),
				maxReportBytes: z.number().int().positive(),
			})
			.strict(),
	})
	.strict();
export type IntegrationCapabilities = z.infer<
	typeof integrationCapabilitiesSchema
>;

export const integrationPreviewRequestSchema = z
	.object({
		projectPath: projectPathSchema,
		selection: integrationScanSelectionSchema,
		target: integrationTargetSchema,
	})
	.strict();
export type IntegrationPreviewRequest = z.infer<
	typeof integrationPreviewRequestSchema
>;

export const integrationPreviewSchema = z
	.object({
		previewRef: opaqueRefSchema,
		resolvedProfileRef: opaqueRefSchema,
		target: z
			.object({
				kind: integrationTargetKindSchema,
				digest: sha256Schema,
				sourceRevision: z.string().min(1).max(128).nullable(),
				fileCount: z.number().int().nonnegative().nullable(),
			})
			.strict(),
		estimatedDurationSeconds: z
			.object({
				min: z.number().int().nonnegative(),
				max: z.number().int().positive(),
			})
			.refine((value) => value.max >= value.min)
			.strict(),
		toolSteps: z.array(
			z
				.object({
					id: z.string().min(1).max(128),
					name: z.string().min(1).max(256),
					category: z.string().min(1).max(64),
					required: z.boolean(),
					availability: z.enum(["available", "unavailable", "conditional"]),
					reason: z.string().max(512).optional(),
				})
				.strict(),
		),
		warnings: z.array(z.string().max(512)).max(64),
		expiresAt: timestampSchema,
	})
	.strict();
export type IntegrationPreview = z.infer<typeof integrationPreviewSchema>;

export const integrationStartScanRequestSchema = integrationPreviewRequestSchema
	.extend({
		previewRef: opaqueRefSchema,
		expectedTargetDigest: sha256Schema,
	})
	.strict();
export type IntegrationStartScanRequest = z.infer<
	typeof integrationStartScanRequestSchema
>;

const integrationResolvedTargetSchema = z
	.object({
		kind: integrationTargetKindSchema,
		digest: sha256Schema,
		sourceRevision: z.string().min(1).max(128).nullable(),
	})
	.strict();

export const integrationStartScanResponseSchema = z
	.object({
		scanRunRef: opaqueRefSchema,
		status: integrationExecutionStatusSchema,
		resolvedProfileRef: opaqueRefSchema,
		target: integrationResolvedTargetSchema,
		createdAt: timestampSchema,
		replayed: z.boolean(),
	})
	.strict();
export type IntegrationStartScanResponse = z.infer<
	typeof integrationStartScanResponseSchema
>;

export const integrationSeverityCountsSchema = z
	.object({
		critical: z.number().int().nonnegative(),
		high: z.number().int().nonnegative(),
		medium: z.number().int().nonnegative(),
		low: z.number().int().nonnegative(),
		info: z.number().int().nonnegative(),
		unknown: z.number().int().nonnegative(),
	})
	.strict();

export const integrationScanRunDetailSchema = z
	.object({
		scanRunRef: opaqueRefSchema,
		status: integrationExecutionStatusSchema,
		outcome: integrationSecurityOutcomeSchema.nullable(),
		presetId: integrationScanPresetIdSchema.nullable(),
		profileRef: opaqueRefSchema,
		target: integrationResolvedTargetSchema,
		progress: z
			.object({
				completedSteps: z.number().int().nonnegative(),
				totalSteps: z.number().int().nonnegative(),
				currentStep: z.string().max(256).nullable(),
			})
			.strict(),
		summary: z
			.object({
				findingCount: z.number().int().nonnegative(),
				severityCounts: integrationSeverityCountsSchema,
				coverage: z
					.object({
						completed: z.number().int().nonnegative(),
						skipped: z.number().int().nonnegative(),
						failed: z.number().int().nonnegative(),
						gaps: z.array(
							z
								.object({
									code: z.string().min(1).max(64),
									message: z.string().min(1).max(512),
								})
								.strict(),
						),
					})
					.strict(),
			})
			.strict()
			.nullable(),
		lastEventSeq: z.number().int().nonnegative(),
		createdAt: timestampSchema,
		startedAt: nullableTimestampSchema,
		completedAt: nullableTimestampSchema,
		error: z
			.object({
				code: z.string().min(1).max(128),
				message: z.string().min(1).max(1024),
				retryable: z.boolean(),
			})
			.strict()
			.nullable(),
	})
	.strict();
export type IntegrationScanRunDetail = z.infer<
	typeof integrationScanRunDetailSchema
>;

export const integrationScanEventPageSchema = z
	.object({
		items: z.array(
			z
				.object({
					seq: z.number().int().positive(),
					level: z.enum(["debug", "info", "warning", "error"]),
					type: z.string().min(1).max(128),
					message: z.string().min(1).max(1024),
					stepRef: z.string().max(128).nullable(),
					createdAt: timestampSchema,
				})
				.strict(),
		),
		nextAfterSeq: z.number().int().nonnegative(),
		hasMore: z.boolean(),
	})
	.strict();
export type IntegrationScanEventPage = z.infer<
	typeof integrationScanEventPageSchema
>;

export const integrationFindingPageSchema = z
	.object({
		items: z.array(
			z
				.object({
					ref: opaqueRefSchema,
					severity: integrationSeveritySchema,
					title: z.string().min(1).max(1024),
					category: z.string().max(256).nullable(),
					tool: z.string().min(1).max(128),
					ruleId: z.string().max(512).nullable(),
					location: z
						.object({
							path: z.string().max(4096).nullable(),
							startLine: z.number().int().positive().nullable(),
							endLine: z.number().int().positive().nullable(),
						})
						.strict(),
					description: z.string().max(16_384).nullable(),
					evidence: z.string().max(16_384).nullable(),
					recommendation: z.string().max(16_384).nullable(),
					references: z.array(z.string().url().max(2048)).max(64),
				})
				.strict(),
		),
		nextCursor: z.string().max(2048).nullable(),
	})
	.strict();
export type IntegrationFindingPage = z.infer<
	typeof integrationFindingPageSchema
>;

export const integrationReportSummaryModeSchema = z.literal(
	"deterministic_with_llm_summary",
);

export const integrationStartReportRequestSchema = z
	.object({ summaryMode: integrationReportSummaryModeSchema })
	.strict();

export const integrationReportDetailSchema = z
	.object({
		reportRef: opaqueRefSchema,
		scanRunRef: opaqueRefSchema,
		status: integrationReportStatusSchema,
		summaryMode: integrationReportSummaryModeSchema,
		title: z.string().max(512).nullable(),
		llm: z
			.object({
				provider: z.string().min(1).max(128),
				model: z.string().min(1).max(256),
			})
			.strict()
			.nullable(),
		createdAt: timestampSchema,
		startedAt: nullableTimestampSchema,
		completedAt: nullableTimestampSchema,
		content: z
			.object({
				mediaType: z.literal("text/markdown"),
				byteLength: z.number().int().nonnegative(),
				sha256: sha256Schema,
			})
			.strict()
			.nullable(),
		error: z
			.object({
				code: z.string().min(1).max(128),
				message: z.string().min(1).max(1024),
				retryable: z.boolean(),
			})
			.strict()
			.nullable(),
	})
	.strict();
export type IntegrationReportDetail = z.infer<
	typeof integrationReportDetailSchema
>;

export const integrationStartReportResponseSchema = z
	.object({
		report: integrationReportDetailSchema,
		replayed: z.boolean(),
	})
	.strict();
export type IntegrationStartReportResponse = z.infer<
	typeof integrationStartReportResponseSchema
>;

export const integrationReportListSchema = z
	.object({ items: z.array(integrationReportDetailSchema) })
	.strict();
