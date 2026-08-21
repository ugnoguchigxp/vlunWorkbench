import { z } from "zod";
import { scanCapabilityRequirementsSchema } from "./scan-capability.schema";
import { scanTargetKindSchema } from "./scan-target.schema";
import { sha256DigestSchema } from "./security-capability.schema";

const catalogIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
	.max(100);

export const scanProfileAvailabilitySchema = z.enum([
	"stable",
	"experimental",
	"planned",
	"deprecated",
]);
export const scanProfileSafetyClassSchema = z.enum([
	"R0",
	"R1",
	"R2",
	"R3",
	"mixed",
]);
export const scanProfileLaunchModeSchema = z.enum([
	"profile_orchestrator",
	"dedicated_flow",
	"run_group",
	"unavailable",
]);
export const scanProfileLaunchDestinationSchema = z.enum([
	"scan_workspace",
	"dynamic_workspace",
	"dast_workspace",
	"business_logic_workspace",
	"finding_verification",
	"professional_run_group",
]);
export const scanProfileInputKindSchema = z.enum([
	"source_target",
	"image_ref",
	"image_tar",
	"runtime_target",
	"auto_start_plan",
	"execution_consent",
	"auth_context_ref",
	"attestation_subject",
	"attestation_bundle",
	"trust_policy",
	"disposable_target_ref",
	"rules_of_engagement_ref",
	"scenario_ref",
	"finding_ref",
]);
export type ScanProfileInputKind = z.infer<typeof scanProfileInputKindSchema>;
export const scanProfileRequirementSchema = z.enum([
	"required",
	"required_if_applicable",
	"advisory",
]);
export const scanResultPolicySchema = z.enum(["gate", "advisory"]);
export type ScanResultPolicy = z.infer<typeof scanResultPolicySchema>;
export const scanGateSeveritySchema = z.enum([
	"low",
	"medium",
	"high",
	"critical",
]);

export const scanProfileExecutionVariantSchema = z
	.object({
		id: catalogIdSchema,
		executionProfileRef: z.string().min(1).max(160),
		requiredInputKinds: z.array(scanProfileInputKindSchema).max(16),
		forbiddenInputKinds: z.array(scanProfileInputKindSchema).max(16),
	})
	.strict();

export const scanProfileCatalogEntrySchema = z
	.object({
		schemaVersion: z.literal(1),
		id: catalogIdSchema,
		catalogVersion: z.number().int().positive(),
		displayOrder: z.number().int().nonnegative(),
		displayName: z.string().min(1).max(160),
		description: z.string().min(1).max(1000),
		availability: scanProfileAvailabilitySchema,
		safetyClass: scanProfileSafetyClassSchema,
		launchMode: scanProfileLaunchModeSchema,
		launchDestination: scanProfileLaunchDestinationSchema.nullable(),
		strictness: z.enum(["strict", "best_effort"]),
		defaultResultPolicy: scanResultPolicySchema,
		allowedResultPolicies: z.array(scanResultPolicySchema).min(1).max(2),
		gateSeverityThreshold: scanGateSeveritySchema.nullable(),
		supportedTargets: z.array(scanTargetKindSchema).min(1).max(4),
		requiredInputs: z
			.array(
				z
					.object({
						kind: scanProfileInputKindSchema,
						requirement: scanProfileRequirementSchema,
					})
					.strict(),
			)
			.max(16),
		capabilityRequirements: scanCapabilityRequirementsSchema,
		executionVariants: z.array(scanProfileExecutionVariantSchema).max(8),
		environmentRequirementCodes: z.array(z.string().min(1).max(100)).max(32),
		limitationCodes: z.array(z.string().min(1).max(100)).max(32),
		replacementProfileId: catalogIdSchema.nullable(),
	})
	.strict();
export type ScanProfileCatalogEntry = z.infer<
	typeof scanProfileCatalogEntrySchema
>;

export const scanProfileLegacyAssociationSchema = z
	.object({
		legacyProfileId: z.string().min(1).max(160),
		canonicalProfileId: catalogIdSchema,
		migrationKind: z.enum(["canonical", "exact_alias", "legacy_preset"]),
	})
	.strict();
export type ScanProfileLegacyAssociation = z.infer<
	typeof scanProfileLegacyAssociationSchema
>;

export const scanProfileResolutionSchema = z
	.object({
		schemaVersion: z.literal(1),
		requestedProfileId: z.string().min(1).max(160),
		canonicalProfileId: catalogIdSchema,
		executionProfileId: z.string().min(1).max(160).nullable(),
		executionVariantId: z.string().min(1).max(100).nullable(),
		catalogVersion: z.number().int().positive(),
		catalogEntryHash: sha256DigestSchema,
		migrationKind: z.enum(["canonical", "exact_alias", "legacy_preset"]),
		launchMode: scanProfileLaunchModeSchema,
		availability: scanProfileAvailabilitySchema,
		strictness: z.enum(["strict", "best_effort"]),
		resultPolicy: scanResultPolicySchema,
		gateSeverityThreshold: scanGateSeveritySchema.nullable(),
		providedInputKinds: z.array(scanProfileInputKindSchema),
		launchability: z.enum(["launchable", "blocked", "not_applicable"]),
		reasonCodes: z.array(z.string().min(1).max(100)).max(32),
		warningCodes: z.array(z.string().min(1).max(100)).max(32),
	})
	.strict();
export type ScanProfileResolution = z.infer<typeof scanProfileResolutionSchema>;
