import { z } from "zod";
import {
	scanProfileAvailabilitySchema,
	scanProfileSafetyClassSchema,
} from "./scan-profile-catalog.schema";

/** The only profile identifiers that may be exposed by the launch API. */
export const canonicalProfileIdSchema = z.enum([
	"change-gate",
	"source-assurance",
	"dependency-supply-chain",
	"release-artifact",
	"dynamic-verification",
	"sanitizer-fuzz-lab",
	"custom-dynamic-lab",
	"runtime-passive",
	"authenticated-web",
	"api-readonly",
	"active-technical-lab",
	"business-logic-lab",
	"remediation-verification",
	"professional-full",
]);
export type CanonicalProfileId = z.infer<typeof canonicalProfileIdSchema>;

export const executionEngineIdSchema = z.enum([
	"repository",
	"supply-artifact",
	"isolated-code",
	"passive-runtime",
	"controlled-active",
	"replay",
	"run-group",
]);
export type ExecutionEngineId = z.infer<typeof executionEngineIdSchema>;

export const scanReadinessStatusSchema = z.enum([
	"ready",
	"needs_input",
	"needs_setup",
	"not_applicable",
	"blocked_environment",
	"unavailable",
]);
export type ScanReadinessStatus = z.infer<typeof scanReadinessStatusSchema>;

export const scanProfileDefinitionVariantSchema = z
	.object({
		id: z
			.string()
			.regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
			.max(100),
		stepIds: z.array(z.string().min(1).max(160)).min(1).max(32),
		qualificationFixture: z
			.string()
			.regex(
				/^scripts\/scan-profile-qualification\/fixtures\/[a-z0-9-]+\.json$/,
			),
	})
	.strict();
export type ScanProfileDefinitionVariant = z.infer<
	typeof scanProfileDefinitionVariantSchema
>;

/**
 * Serializable projection of the server-side ProfileDefinition registry.
 * Callback-based readiness and plan factories stay server-side; this schema
 * is used to assert the public catalog cannot outgrow execution coverage.
 */
export const scanProfileDefinitionSchema = z
	.object({
		id: canonicalProfileIdSchema,
		availability: scanProfileAvailabilitySchema,
		safetyClass: scanProfileSafetyClassSchema,
		engineId: executionEngineIdSchema,
		variants: z.array(scanProfileDefinitionVariantSchema).min(1).max(8),
		dependencyIds: z.array(z.string().min(1).max(160)).min(1).max(32),
	})
	.strict();
export type ScanProfileDefinition = z.infer<typeof scanProfileDefinitionSchema>;
