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
const slsaProvenanceInput = z
	.object({
		kind: z.literal("slsa_provenance"),
		subject: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
		provenance: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
		policy: z
			.object({ path: repoPathSchema, expectedSha256: digestSchema })
			.strict(),
	})
	.strict();
const supplyChainInput = z.union([attestationInput, slsaProvenanceInput]);
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
const sanitizerFuzzInput = builtinDynamicInput.extend({
	dynamicKind: z.enum(["sanitizer", "fuzz"]),
});
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
const apiInputBase = z
	.object({
		kind: z.literal("api_readonly"),
		runtime: z.object({ mode: z.literal("auto_project_runtime") }).strict(),
		schemaSource: z.object({ mode: z.literal("auto") }).strict(),
		authContextRef: uuidSchema.optional(),
		expectedAuthContextHash: digestSchema.optional(),
		identityRole: z.string().min(1).max(100).optional(),
	})
	.strict();
const apiInput = apiInputBase.superRefine((value, ctx) => {
	const authFields = [
		value.authContextRef,
		value.expectedAuthContextHash,
		value.identityRole,
	];
	if (authFields.some(Boolean) && !authFields.every(Boolean))
		ctx.addIssue({
			code: "custom",
			path: ["authContextRef"],
			message:
				"authContextRef, expectedAuthContextHash, and identityRole must be provided together",
		});
});
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

const common = {
	schemaVersion: z.literal(1),
	target: scanTargetSchema,
	resultPolicy: z.enum(["advisory", "gate"]).optional(),
	timeoutSec: z.number().int().positive().max(3600).optional(),
};

function launchBranch(
	profileId: z.infer<typeof canonicalProfileIdSchema>,
	input: z.ZodTypeAny,
) {
	return z
		.object({ ...common, profileId: z.literal(profileId), input })
		.strict();
}

const launchInputSchemas = {
	"change-gate": sourceInput,
	"source-assurance": sourceInput,
	"dependency-supply-chain": supplyChainInput,
	"release-artifact": releaseInput,
	"dynamic-verification": builtinDynamicInput,
	"sanitizer-fuzz-lab": sanitizerFuzzInput,
	"custom-dynamic-lab": customDynamicInput,
	"runtime-passive": runtimeInput,
	"authenticated-web": authenticatedInput,
	"api-readonly": apiInput,
	"active-technical-lab": activeInput,
	"business-logic-lab": businessInput,
	"remediation-verification": remediationInput,
} satisfies Record<z.infer<typeof canonicalProfileIdSchema>, z.ZodTypeAny>;

export function isCompleteScanLaunchInput(
	profileId: z.infer<typeof canonicalProfileIdSchema>,
	input: unknown,
): boolean {
	return launchInputSchemas[profileId].safeParse(input).success;
}

export const scanLaunchStartRequestSchema = z.union(
	[
		launchBranch("change-gate", sourceInput),
		launchBranch("source-assurance", sourceInput),
		launchBranch("dependency-supply-chain", supplyChainInput),
		launchBranch("release-artifact", releaseInput),
		launchBranch("dynamic-verification", builtinDynamicInput),
		launchBranch("sanitizer-fuzz-lab", sanitizerFuzzInput),
		launchBranch("custom-dynamic-lab", customDynamicInput),
		launchBranch("runtime-passive", runtimeInput),
		launchBranch("authenticated-web", authenticatedInput),
		launchBranch("api-readonly", apiInput),
		launchBranch("active-technical-lab", activeInput),
		launchBranch("business-logic-lab", businessInput),
		launchBranch("remediation-verification", remediationInput),
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
	previewBranch(
		"dependency-supply-chain",
		z.union([attestationInput.partial(), slsaProvenanceInput.partial()]),
	),
	previewBranch(
		"release-artifact",
		z.union([
			releaseInput.options[0].partial(),
			releaseInput.options[1].partial(),
			releaseInput.options[2].partial(),
		]),
	),
	previewBranch("dynamic-verification", builtinDynamicInput.partial()),
	previewBranch("sanitizer-fuzz-lab", sanitizerFuzzInput.partial()),
	previewBranch("custom-dynamic-lab", customDynamicInput.partial()),
	previewBranch("runtime-passive", runtimeInput.partial()),
	previewBranch("authenticated-web", authenticatedInput.partial()),
	previewBranch("api-readonly", apiInputBase.partial()),
	previewBranch("active-technical-lab", activeInput.partial()),
	previewBranch("business-logic-lab", businessInput.partial()),
	previewBranch("remediation-verification", remediationInput.partial()),
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
		warningCodes: z.array(z.string().min(1).max(100)).max(32),
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
