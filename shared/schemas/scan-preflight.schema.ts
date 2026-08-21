import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

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
	evidenceRefs: z.array(z.string().min(1).max(200)).max(10),
});

export const scanPreflightBindingSchema = z.object({
	resolvedProfileHash: sha256DigestSchema,
	executionHash: sha256DigestSchema,
	scannerManifestHash: sha256DigestSchema.nullable(),
	scannerVersionsHash: sha256DigestSchema,
	dockerImagesHash: sha256DigestSchema.nullable(),
	targetPlanHash: sha256DigestSchema.nullable(),
	sourceRevisionHash: sha256DigestSchema.nullable(),
});

export const scanPreflightSummarySchema = z.object({
	ready: z.number().int().nonnegative(),
	blockedRequired: z.number().int().nonnegative(),
	blockedOptional: z.number().int().nonnegative(),
	notApplicable: z.number().int().nonnegative(),
});

export const scanPreflightResultSchema = z.object({
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

export type ScanPreflightMode = z.infer<typeof scanPreflightModeSchema>;
export type ScanPreflightCheck = z.infer<typeof scanPreflightCheckSchema>;
export type ScanPreflightResult = z.infer<typeof scanPreflightResultSchema>;
