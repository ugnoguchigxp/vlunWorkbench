import { z } from "zod";

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
	profileId: z.literal("http-baseline"),
	displayName: z.string(),
	required: z.boolean(),
	timeoutSec: z.number().int().positive().optional(),
	failurePolicy: profileToolFailurePolicySchema,
	target: z.object({
		mode: z.literal("auto_project_start"),
	}),
	options: z
		.object({
			maxRequests: z.number().int().positive().optional(),
			readinessTimeoutMs: z.number().int().positive().optional(),
		})
		.optional(),
});
export type DastProfileStep = z.infer<typeof dastProfileStepSchema>;

export const scanProfileStepSchema = z.discriminatedUnion("kind", [
	staticToolProfileStepSchema,
	dastProfileStepSchema,
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
	tools: z.array(profileToolEntrySchema),
	steps: z.array(scanProfileStepSchema).optional(),
});
export type ScanProfile = z.infer<typeof scanProfileSchema>;
