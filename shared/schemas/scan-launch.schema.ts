import { z } from "zod";
import { runActiveAssessmentRequestSchema } from "./active-assessment.schema";
import {
	canonicalProfileIdSchema,
	scanReadinessStatusSchema,
} from "./scan-profile-definition.schema";
import { scanTargetSchema } from "./scan-target.schema";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const uuidSchema = z.string().uuid();
const repoPathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.includes("\\") &&
			!value.split("/").includes(".."),
		"Path must be repository-relative and traversal-free.",
	);
const imageRefSchema = z
	.string()
	.regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);

const sourceInput = z.object({ kind: z.literal("source_target") }).strict();
const attestationInput = z
	.object({
		kind: z.literal("offline_attestation"),
		subject: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
		bundle: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
		trustPolicy: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
	})
	.strict();
const releaseInput = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("filesystem_artifact") }).strict(),
	z
		.object({
			kind: z.literal("container_image_ref"),
			imageRef: imageRefSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("container_image_tar"),
			imageTarPath: repoPathSchema,
			expectedSha256: digestSchema,
		})
		.strict(),
]);
const builtinDynamicInput = z
	.object({
		kind: z.literal("builtin_dynamic"),
		dynamicProfileId: z.string().min(1).max(160),
		executionConsent: z.literal(true),
	})
	.strict();
const customDynamicInput = z
	.object({
		kind: z.literal("custom_dynamic"),
		dynamicConfigRef: uuidSchema,
		expectedConfigHash: digestSchema,
		executionConsent: z.literal(true),
	})
	.strict();
const runtimeInput = z
	.object({
		kind: z.literal("auto_project_runtime"),
		executionConsent: z.literal(true),
	})
	.strict();
const authenticatedInput = z
	.object({
		kind: z.literal("authenticated_web"),
		targetConfigRef: uuidSchema,
		expectedTargetHash: digestSchema,
		authContextRef: uuidSchema,
		expectedAuthContextHash: digestSchema,
		identityRole: z.string().min(1).max(100),
	})
	.strict();
const apiInput = z
	.object({
		kind: z.literal("api_readonly"),
		runtime: z.object({ mode: z.literal("auto_project_runtime") }).strict(),
		schemaSource: z.discriminatedUnion("mode", [
			z.object({ mode: z.literal("auto") }).strict(),
			z
				.object({
					mode: z.literal("configured"),
					schemaRef: uuidSchema,
					expectedSchemaHash: digestSchema,
				})
				.strict(),
		]),
	})
	.strict();
const activeInput = z
	.object({
		kind: z.literal("active_assessment"),
		executionConsent: z.literal(true),
		request: runActiveAssessmentRequestSchema,
	})
	.strict();
const businessInput = z
	.object({
		kind: z.literal("business_logic"),
		scenarioRef: uuidSchema,
		expectedScenarioHash: digestSchema,
		executionConsent: z.literal(true),
	})
	.strict();
const remediationInput = z
	.object({
		kind: z.literal("remediation"),
		findingRef: uuidSchema,
		reproductionProfileId: z.string().min(1).max(160),
		expectedOriginalBindingHash: digestSchema,
	})
	.strict();
const professionalInput = z
	.object({
		kind: z.literal("professional"),
		children: z
			.array(
				z
					.object({
						profileId: canonicalProfileIdSchema.exclude(["professional-full"]),
						previewBindingHash: digestSchema,
					})
					.strict(),
			)
			.min(1)
			.max(13),
		activeScope: z.discriminatedUnion("includeR3", [
			z.object({ includeR3: z.literal(false) }).strict(),
			z
				.object({
					includeR3: z.literal(true),
					executionConsent: z.literal(true),
				})
				.strict(),
		]),
	})
	.strict();

/**
 * Preview accepts incomplete profile-shaped input so it can report the next
 * missing field. It must not accept arbitrary fields: otherwise its binding
 * could describe a different request from the subsequently started scan.
 */
const previewInput = z.union([
	sourceInput.partial(),
	attestationInput.partial(),
	releaseInput.options[0].partial(),
	releaseInput.options[1].partial(),
	releaseInput.options[2].partial(),
	builtinDynamicInput.partial(),
	customDynamicInput.partial(),
	runtimeInput.partial(),
	authenticatedInput.partial(),
	apiInput.partial(),
	activeInput.partial(),
	businessInput.partial(),
	remediationInput.partial(),
	professionalInput.partial(),
	z.object({}).strict(),
]);
const common = {
	schemaVersion: z.literal(1),
	target: scanTargetSchema,
	resultPolicy: z.enum(["advisory", "gate"]).optional(),
	timeoutSec: z.number().int().positive().max(900).optional(),
};

function launchBranch(
	profileId: z.infer<typeof canonicalProfileIdSchema>,
	input: z.ZodTypeAny,
) {
	return z
		.object({ ...common, profileId: z.literal(profileId), input })
		.strict();
}

export const scanLaunchStartRequestSchema = z.union(
	[
		launchBranch("change-gate", sourceInput),
		launchBranch("source-assurance", sourceInput),
		launchBranch("dependency-supply-chain", attestationInput),
		launchBranch("release-artifact", releaseInput),
		launchBranch("dynamic-verification", builtinDynamicInput),
		launchBranch("sanitizer-fuzz-lab", builtinDynamicInput),
		launchBranch("custom-dynamic-lab", customDynamicInput),
		launchBranch("runtime-passive", runtimeInput),
		launchBranch("authenticated-web", authenticatedInput),
		launchBranch("api-readonly", apiInput),
		launchBranch("active-technical-lab", activeInput),
		launchBranch("business-logic-lab", businessInput),
		launchBranch("remediation-verification", remediationInput),
		launchBranch("professional-full", professionalInput),
	].map((schema) =>
		schema.extend({
			expectedCatalogEntryHash: digestSchema,
			expectedReadinessHash: digestSchema,
			expectedPlanHash: digestSchema,
			expectedTargetDigest: digestSchema,
		}),
	) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]],
);
export type ScanLaunchStartRequest = z.infer<
	typeof scanLaunchStartRequestSchema
>;

function previewBranch(
	profileId: z.infer<typeof canonicalProfileIdSchema>,
	input: z.ZodTypeAny,
) {
	return z
		.object({
			...common,
			profileId: z.literal(profileId),
			input: input.optional().default({}),
		})
		.strict();
}

/** Profile ID selects the only partial input shape it may preview. */
export const scanLaunchPreviewRequestSchema = z.union([
	previewBranch("change-gate", sourceInput.partial()),
	previewBranch("source-assurance", sourceInput.partial()),
	previewBranch("dependency-supply-chain", attestationInput.partial()),
	previewBranch("release-artifact", previewInput),
	previewBranch("dynamic-verification", builtinDynamicInput.partial()),
	previewBranch("sanitizer-fuzz-lab", builtinDynamicInput.partial()),
	previewBranch("custom-dynamic-lab", customDynamicInput.partial()),
	previewBranch("runtime-passive", runtimeInput.partial()),
	previewBranch("authenticated-web", authenticatedInput.partial()),
	previewBranch("api-readonly", apiInput.partial()),
	previewBranch("active-technical-lab", activeInput.partial()),
	previewBranch("business-logic-lab", businessInput.partial()),
	previewBranch("remediation-verification", remediationInput.partial()),
	previewBranch("professional-full", professionalInput.partial()),
] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
/** The runtime schema above is the authority; this keeps route consumers
 * typed despite Zod's heterogeneous-union inference limitation. */
export type ScanLaunchPreviewRequest = {
	schemaVersion: 1;
	profileId: z.infer<typeof canonicalProfileIdSchema>;
	target: z.infer<typeof scanTargetSchema>;
	resultPolicy?: "advisory" | "gate";
	timeoutSec?: number;
	input: Record<string, unknown>;
};

export const scanLaunchPreviewSchema = z
	.object({
		schemaVersion: z.literal(1),
		profileId: canonicalProfileIdSchema,
		variantId: z.string().min(1).max(100).nullable(),
		engineId: z.string().min(1).max(100),
		readiness: scanReadinessStatusSchema,
		reasonCodes: z.array(z.string().min(1).max(100)).max(32),
		setupActions: z
			.array(
				z
					.object({
						code: z.string().min(1).max(100),
						labelKey: z.string().min(1).max(200),
						href: z.string().max(500).nullable(),
						requiresAdmin: z.boolean(),
					})
					.strict(),
			)
			.max(16),
		resolvedTargetDigest: digestSchema.nullable(),
		catalogEntryHash: digestSchema,
		readinessHash: digestSchema,
		planHash: digestSchema.nullable(),
	})
	.strict();
export type ScanLaunchPreview = z.infer<typeof scanLaunchPreviewSchema>;
