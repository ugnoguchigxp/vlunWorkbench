import { z } from "zod";
import { scanCapabilityRequirementsSchema } from "./scan-capability.schema";
import { scanTargetKindSchema } from "./scan-target.schema";

export const profileToolFailurePolicySchema = z.enum([
	"fail_profile",
	"warn_and_continue",
]);
export type ProfileToolFailurePolicy = z.infer<
	typeof profileToolFailurePolicySchema
>;

export const scanScopeIntentSchema = z.enum([
	"source",
	"dependency_manifest",
	"artifact",
	"full_deep",
]);
export type ScanScopeIntent = z.infer<typeof scanScopeIntentSchema>;

export const scanScopePolicySchema = z.object({
	intent: scanScopeIntentSchema,
	includeGlobs: z.array(z.string()),
	excludeGlobs: z.array(z.string()),
	includeGenerated: z.boolean(),
	includeInstalledDependencies: z.boolean(),
	includeVendoredDependencies: z.boolean(),
	notes: z.string().optional(),
});
export type ScanScopePolicy = z.infer<typeof scanScopePolicySchema>;

export const profileToolEntrySchema = z.object({
	toolId: z.string(),
	displayName: z.string(),
	required: z.boolean(),
	timeoutSec: z.number().int().positive().optional(),
	options: z.record(z.string(), z.unknown()).optional(),
	failurePolicy: profileToolFailurePolicySchema,
});
export type ProfileToolEntry = z.infer<typeof profileToolEntrySchema>;

export const staticToolProfileStepSchema = profileToolEntrySchema.extend({
	kind: z.literal("static_tool"),
});
export type StaticToolProfileStep = z.infer<typeof staticToolProfileStepSchema>;

export const dastProfileStepSchema = z.object({
	kind: z.literal("dast"),
	profileId: z.enum([
		"http-baseline",
		"web-passive-standard",
		"authenticated-readonly-standard",
	]),
	displayName: z.string(),
	required: z.boolean(),
	timeoutSec: z.number().int().positive().optional(),
	failurePolicy: profileToolFailurePolicySchema,
	target: z.object({
		mode: z.literal("auto_project_start"),
	}),
	options: z
		.object({
			maxRequests: z.number().int().positive().max(100).optional(),
			maxDepth: z.number().int().min(0).max(3).optional(),
			aggregateRequestBudget: z.number().int().positive().max(250).optional(),
			maxDiscoveredUrls: z.number().int().positive().max(500).optional(),
			maxResponseBytes: z
				.number()
				.int()
				.positive()
				.max(1024 * 1024)
				.optional(),
			includeApplicationModelSeeds: z.boolean().optional(),
			includeOpenApiSeeds: z.boolean().optional(),
			readinessTimeoutMs: z.number().int().positive().optional(),
		})
		.optional(),
});
export type DastProfileStep = z.infer<typeof dastProfileStepSchema>;

export const scanStepApplicabilitySchema = z.enum([
	"applicable",
	"not_applicable",
]);
export type ScanStepApplicability = z.infer<typeof scanStepApplicabilitySchema>;

export const scanStepReasonCodeSchema = z.enum([
	"schema_not_found",
	"authentication_required",
	"image_input_not_provided",
	"image_source_unreachable",
	"target_start_not_supported",
	"target_unreachable_from_container",
	"tool_unavailable",
	"policy_rejected",
	"invalid_structured_output",
	"timed_out",
	"execution_failed",
	"no_changed_files",
	"no_relevant_files",
	"no_dependency_manifest_changed",
	"diff_target_not_supported",
]);
export type ScanStepReasonCode = z.infer<typeof scanStepReasonCodeSchema>;

export const coverageEffectSchema = z.enum(["covered", "partial", "gap"]);
export type CoverageEffect = z.infer<typeof coverageEffectSchema>;

const scannerStepBaseSchema = profileToolEntrySchema.pick({
	displayName: true,
	required: true,
	timeoutSec: true,
	failurePolicy: true,
});

export const nucleiSafeOptionsSchema = z.object({
	maxRequests: z.number().int().min(1).max(20).default(20),
	rateLimitPerSec: z.number().positive().max(5).default(2),
});
export type NucleiSafeOptions = z.infer<typeof nucleiSafeOptionsSchema>;

export const zapBaselineOptionsSchema = z.object({
	maxRequests: z.number().int().min(1).max(100).default(20),
	rateLimitPerSec: z.number().positive().max(10).default(2),
	spiderMinutes: z.literal(1).default(1),
	passiveWaitMinutes: z.literal(3).default(3),
});
export type ZapBaselineOptions = z.infer<typeof zapBaselineOptionsSchema>;

export const runtimeScannerStepSchema = z.discriminatedUnion("adapter", [
	scannerStepBaseSchema.extend({
		kind: z.literal("runtime_scanner"),
		adapter: z.literal("nuclei-safe"),
		target: z.object({ mode: z.literal("auto_project_start") }),
		options: nucleiSafeOptionsSchema.optional(),
	}),
	scannerStepBaseSchema.extend({
		kind: z.literal("runtime_scanner"),
		adapter: z.literal("zap-baseline"),
		target: z.object({ mode: z.literal("auto_project_start") }),
		options: zapBaselineOptionsSchema.optional(),
	}),
]);
export type RuntimeScannerStep = z.infer<typeof runtimeScannerStepSchema>;

export const sbomExportStepSchema = scannerStepBaseSchema.extend({
	kind: z.literal("sbom_export"),
	adapter: z.literal("trivy"),
	target: z.object({ mode: z.literal("project_filesystem") }),
	format: z.literal("cyclonedx"),
});
export type SbomExportStep = z.infer<typeof sbomExportStepSchema>;

export const apiSchemaScanStepSchema = scannerStepBaseSchema.extend({
	kind: z.literal("api_schema_scan"),
	adapter: z.literal("schemathesis"),
	target: z.object({ mode: z.literal("auto_project_start") }),
	schema: z.object({
		mode: z.literal("auto_discover"),
		kind: z.enum(["openapi", "graphql", "auto"]),
	}),
	options: z
		.object({
			maxRequests: z.number().int().min(1).max(30).default(30),
			rateLimitPerSec: z.number().positive().max(5).default(2),
		})
		.optional(),
});
export type ApiSchemaScanStep = z.infer<typeof apiSchemaScanStepSchema>;

export const containerImageScanStepSchema = scannerStepBaseSchema.extend({
	kind: z.literal("container_image_scan"),
	adapter: z.literal("trivy"),
	target: z.object({ mode: z.literal("explicit_existing_image") }),
});
export type ContainerImageScanStep = z.infer<
	typeof containerImageScanStepSchema
>;

export const attestationVerifyStepSchema = scannerStepBaseSchema.extend({
	kind: z.literal("attestation_verify"),
	adapter: z.literal("cosign"),
	target: z.object({ mode: z.literal("repository_relative_files") }),
});
export type AttestationVerifyStep = z.infer<typeof attestationVerifyStepSchema>;

export const scanProfileStepSchema = z.discriminatedUnion("kind", [
	staticToolProfileStepSchema,
	dastProfileStepSchema,
	runtimeScannerStepSchema,
	sbomExportStepSchema,
	apiSchemaScanStepSchema,
	containerImageScanStepSchema,
	attestationVerifyStepSchema,
]);
export type ScanProfileStep = z.infer<typeof scanProfileStepSchema>;

export const scanProfileSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	category: z.enum(["basic", "focused", "detailed"]).optional(),
	enabled: z.boolean(),
	defaultTimeoutSec: z.number().int().positive(),
	scope: scanScopePolicySchema.optional(),
	supportedTargets: z.array(scanTargetKindSchema).optional(),
	tools: z.array(profileToolEntrySchema),
	steps: z.array(scanProfileStepSchema).optional(),
	/** Declared capability contract; absent for legacy profiles. */
	capabilityRequirements: scanCapabilityRequirementsSchema.optional(),
	coverageGaps: z.array(z.string().min(1).max(100)).max(20).optional(),
	/**
	 * Strict profiles are release-grade contracts: every applicable capability
	 * must complete and an incomplete preflight must block execution.
	 */
	strictness: z.enum(["strict", "best_effort"]).optional(),
});
export type ScanProfile = z.infer<typeof scanProfileSchema>;
