import { z } from "zod";
import { scanCapabilityRequirementsSchema } from "./scan-capability.schema";
import { sha256DigestSchema } from "./security-capability.schema";
import { runtimeDatabaseModeSchema } from "./runtime-isolation.schema";

export const scanExecutionStrictnessSchema = z.enum(["strict", "best_effort"]);
export const scanExecutionStepSchema = z.object({
	stepId: z.string().min(1).max(160),
	kind: z.enum([
		"static_tool",
		"dast",
		"runtime_scanner",
		"sbom_export",
		"api_schema_scan",
		"container_image_scan",
		"attestation_verify",
	]),
	adapter: z.string().min(1).max(100),
	required: z.boolean(),
	applicability: z.enum(["applicable", "not_applicable", "unknown"]),
	readiness: z.enum(["ready", "blocked", "unchecked"]),
	requirement: z.enum(["required_if_applicable", "advisory", "inventory"]),
	reasonCodes: z.array(z.string().min(1).max(100)).max(32),
	evidenceRefs: z.array(z.string().min(1).max(200)).max(32),
});

export const scanExecutionPlanV1Schema = z.object({
	schemaVersion: z.literal(1),
	scanRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	profileId: z.string().min(1).max(160),
	/** The plan is immutable; this is the corresponding preflight timestamp. */
	createdAt: z.string().datetime(),
	profileVersion: z.number().int().positive(),
	strictness: scanExecutionStrictnessSchema,
	sourceRevision: z
		.string()
		.regex(/^[a-f0-9]{40,64}$/)
		.nullable(),
	sourceRevisionHash: sha256DigestSchema.nullable(),
	sourceSnapshotDigest: z
		.string()
		.regex(/^[a-f0-9]{64}$/)
		.nullable(),
	sourceState: z.enum(["clean", "dirty", "unknown"]),
	resolvedProfileHash: sha256DigestSchema,
	scannerManifestHash: sha256DigestSchema.nullable(),
	scannerVersionsHash: sha256DigestSchema,
	dockerImagesHash: sha256DigestSchema.nullable(),
	targetPlanHash: sha256DigestSchema.nullable(),
	technologyRegistryDigest: sha256DigestSchema.nullable(),
	orchestrator: z.object({
		id: z.literal("profile-orchestrator"),
		version: z.literal(1),
		runner: z.enum(["host", "docker"]),
	}),
	preflightBindingHash: sha256DigestSchema,
	preflightHash: sha256DigestSchema,
	planHash: sha256DigestSchema,
	qualificationHash: sha256DigestSchema.nullable(),
	blockerCodes: z.array(z.string().min(1).max(100)).max(100),
	warningCodes: z.array(z.string().min(1).max(100)).max(100),
	steps: z.array(scanExecutionStepSchema).min(1).max(64),
});

export const scanExecutionPlanV2StepSchema = scanExecutionStepSchema.extend({
	inputBindingHash: sha256DigestSchema.nullable(),
	policyHash: sha256DigestSchema.nullable(),
	budget: z.object({
		timeoutSec: z.number().int().positive().max(86_400).nullable(),
		maxRequests: z.number().int().positive().max(1_000_000).nullable(),
	}),
	cleanupRequirement: z.enum(["not_required", "required"]),
});

export const scanExecutionPlanV2Schema = scanExecutionPlanV1Schema.extend({
	schemaVersion: z.literal(2),
	capabilityRequirements: scanCapabilityRequirementsSchema,
	safety: z.object({
		networkPolicy: z.enum(["offline", "allowlisted", "isolated"]),
		approvalRequired: z.boolean(),
		approvalRef: z.string().min(1).max(200).nullable(),
	}),
	steps: z.array(scanExecutionPlanV2StepSchema).min(1).max(64),
});

export const scanExecutionPlanV3Schema = scanExecutionPlanV2Schema.extend({
	schemaVersion: z.literal(3),
	runtimeIsolation: z
		.object({
			planHash: sha256DigestSchema,
			qualificationHash: sha256DigestSchema,
			sourceSnapshotDigest: sha256DigestSchema,
			projectionDigest: sha256DigestSchema,
			recipeHash: sha256DigestSchema,
			dependencyLockDigest: sha256DigestSchema,
			dockerDaemonIdentityHash: sha256DigestSchema,
			imageDigests: z.record(z.string().min(1).max(100), sha256DigestSchema),
			databaseMode: runtimeDatabaseModeSchema,
		})
		.strict(),
});

export const scanExecutionPlanSchema = z.discriminatedUnion("schemaVersion", [
	scanExecutionPlanV1Schema,
	scanExecutionPlanV2Schema,
	scanExecutionPlanV3Schema,
]);

export type ScanExecutionPlanV1 = z.infer<typeof scanExecutionPlanV1Schema>;
export type ScanExecutionPlanV2 = z.infer<typeof scanExecutionPlanV2Schema>;
export type ScanExecutionPlanV3 = z.infer<typeof scanExecutionPlanV3Schema>;
export type ScanExecutionPlan = z.infer<typeof scanExecutionPlanSchema>;
