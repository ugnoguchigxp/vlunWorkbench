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
]);
export type CanonicalProfileId = z.infer<typeof canonicalProfileIdSchema>;

export const executionEngineIdSchema = z.enum([
	"repository",
	"supply-artifact",
	"isolated-code",
	"passive-runtime",
	"controlled-active",
	"replay",
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
		dependencyIds: z
			.array(z.string().min(1).max(160))
			.min(1)
			.max(32)
			.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		for (const [field, entries] of [
			["stepIds", value.stepIds],
			["dependencyIds", value.dependencyIds ?? []],
		] as const) {
			const seen = new Set<string>();
			for (const [index, entry] of entries.entries()) {
				if (seen.has(entry))
					context.addIssue({
						code: z.ZodIssueCode.custom,
						path: [field, index],
						message: `${field} must not contain duplicates.`,
					});
				seen.add(entry);
			}
		}
	});
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
	.strict()
	.superRefine((value, context) => {
		const variantIds = new Set<string>();
		const dependencyIds = new Set(value.dependencyIds);
		for (const [index, variant] of value.variants.entries()) {
			if (variantIds.has(variant.id))
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["variants", index, "id"],
					message: "Variant IDs must be unique.",
				});
			variantIds.add(variant.id);
			for (const [dependencyIndex, dependencyId] of (
				variant.dependencyIds ?? []
			).entries()) {
				if (!dependencyIds.has(dependencyId))
					context.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["variants", index, "dependencyIds", dependencyIndex],
						message: "Variant dependencies must be declared by the profile.",
					});
			}
		}
		const seenDependencyIds = new Set<string>();
		for (const [index, dependencyId] of value.dependencyIds.entries()) {
			if (seenDependencyIds.has(dependencyId))
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["dependencyIds", index],
					message: "Dependency IDs must be unique.",
				});
			seenDependencyIds.add(dependencyId);
		}
	});
export type ScanProfileDefinition = z.infer<typeof scanProfileDefinitionSchema>;
