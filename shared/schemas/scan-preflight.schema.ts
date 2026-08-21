import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";
import { runtimeDatabaseModeSchema } from "./runtime-isolation.schema";

export const SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT = 10;

export const scanPreflightModeSchema = z.enum(["shadow", "enforced"]);
export const scanPreflightCheckStatusSchema = z.enum([
	"ready",
	"blocked",
	"not_applicable",
]);
export const scanPreflightStatusSchema = z.enum([
	"ready",
	"ready_with_gaps",
	"blocked",
]);
export const scanPreflightCheckKindSchema = z.enum([
	"adapter_registration",
	"binary_version",
	"scanner_data",
	"docker_daemon",
	"docker_image",
	"target_start_plan",
	"project_code_consent",
	"sandbox_availability",
	"api_schema_applicability",
	"browser_runtime",
	"scanner_e2e_qualification",
	"source_revision",
	"profile_input",
	"runtime_source_projection",
	"runtime_dependency_preparation",
	"runtime_database_isolation",
	"runtime_network_isolation",
	"runtime_cleanup_capability",
]);
export const scanPreflightActionSchema = z.enum([
	"configure_scanner_adapter",
	"build_toolbox_image",
	"prepare_scanner_database",
	"start_docker_daemon",
	"pull_pinned_image",
	"install_playwright_browser",
	"grant_project_code_consent",
	"configure_target_start_plan",
	"configure_api_schema",
	"configure_project_sandbox",
	"run_scanner_e2e_qualification",
	"commit_or_clean_worktree",
	"provide_profile_input",
	"create_runtime_recipe",
	"use_supported_npm_lock",
	"run_runtime_isolation_qualification",
]);

export const scanPreflightCheckSchema = z.object({
	id: z
		.string()
		.regex(/^[a-z0-9][a-z0-9:_-]*$/)
		.max(160),
	stepId: z.string().min(1).max(160),
	kind: scanPreflightCheckKindSchema,
	required: z.boolean(),
	status: scanPreflightCheckStatusSchema,
	reasonCode: z.string().min(1).max(100).nullable(),
	action: scanPreflightActionSchema.nullable(),
	scannerId: z.string().min(1).max(80).nullable(),
	observedVersion: z.string().min(1).max(200).nullable(),
	expectedVersion: z.string().min(1).max(100).nullable(),
	expectedDigest: sha256DigestSchema.nullable(),
	observedDigest: sha256DigestSchema.nullable(),
	expectedPlatform: z.string().min(1).max(80).nullable().optional(),
	observedPlatform: z.string().min(1).max(80).nullable().optional(),
	dataState: z.enum(["ready", "missing", "stale", "external"]).nullable(),
	dataGeneratedAt: z.string().datetime().nullable(),
	evidenceRefs: z
		.array(z.string().min(1).max(200))
		.max(SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT),
});

export const scanPreflightBindingSchema = z.object({
	resolvedProfileHash: sha256DigestSchema,
	executionHash: sha256DigestSchema,
	scannerManifestHash: sha256DigestSchema.nullable(),
	scannerVersionsHash: sha256DigestSchema,
	dockerImagesHash: sha256DigestSchema.nullable(),
	targetPlanHash: sha256DigestSchema.nullable(),
	sourceRevisionHash: sha256DigestSchema.nullable(),
	profileInputsHash: sha256DigestSchema.nullable().optional(),
});

export const scanPreflightSummarySchema = z.object({
	ready: z.number().int().nonnegative(),
	blockedRequired: z.number().int().nonnegative(),
	blockedOptional: z.number().int().nonnegative(),
	notApplicable: z.number().int().nonnegative(),
});

export const scanPreflightResultV1Schema = z.object({
	schemaVersion: z.literal(1),
	projectId: z.string().min(1).max(100).nullable(),
	profileId: z.string().min(1).max(100),
	sourceRevision: z
		.string()
		.regex(/^[a-f0-9]{40,64}$/)
		.nullable(),
	sourceState: z.enum(["clean", "dirty", "unknown"]),
	mode: scanPreflightModeSchema,
	status: scanPreflightStatusSchema,
	createdAt: z.string().datetime(),
	checks: z.array(scanPreflightCheckSchema).max(200),
	summary: scanPreflightSummarySchema,
	limitationCodes: z.array(z.string().min(1).max(100)).max(100),
	binding: scanPreflightBindingSchema,
	bindingHash: sha256DigestSchema,
	preflightHash: sha256DigestSchema,
});

export const runtimeIsolationPreflightBindingSchema = z
	.object({
		sourceSnapshotDigest: sha256DigestSchema,
		runtimeProjectionDigest: sha256DigestSchema,
		recipeHash: sha256DigestSchema,
		dependencyLockDigest: sha256DigestSchema,
		runtimeIsolationPlanHash: sha256DigestSchema,
		runtimeIsolationQualificationHash: sha256DigestSchema,
		dockerDaemonIdentityHash: sha256DigestSchema,
		imageDigests: z.record(z.string().min(1).max(100), sha256DigestSchema),
		databaseMode: runtimeDatabaseModeSchema,
	})
	.strict();

export const scanPreflightResultV2Schema = scanPreflightResultV1Schema.extend({
	schemaVersion: z.literal(2),
	binding: scanPreflightBindingSchema.extend({
		runtimeIsolation: runtimeIsolationPreflightBindingSchema,
	}),
});

/** Parses saved V1/V2 records without forcing callers to upgrade historic runs. */
export const scanPreflightAnyResultSchema = z.discriminatedUnion(
	"schemaVersion",
	[scanPreflightResultV1Schema, scanPreflightResultV2Schema],
);

/** The established V1 writer remains available while runtime profiles move to V2. */
export const scanPreflightResultSchema = scanPreflightResultV1Schema;

export type ScanPreflightMode = z.infer<typeof scanPreflightModeSchema>;
export type ScanPreflightCheck = z.infer<typeof scanPreflightCheckSchema>;
export type ScanPreflightResultV1 = z.infer<typeof scanPreflightResultV1Schema>;
export type ScanPreflightResultV2 = z.infer<typeof scanPreflightResultV2Schema>;
export type ScanPreflightResult = ScanPreflightResultV1;
export type AnyScanPreflightResult = z.infer<
	typeof scanPreflightAnyResultSchema
>;
