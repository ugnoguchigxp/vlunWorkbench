import { z } from "zod";

export const profileToolFailurePolicySchema = z.enum([
	"fail_profile",
	"warn_and_continue",
]);
export type ProfileToolFailurePolicy = z.infer<
	typeof profileToolFailurePolicySchema
>;

export const profileToolEntrySchema = z.object({
	toolId: z.string(),
	displayName: z.string(),
	required: z.boolean(),
	timeoutSec: z.number().int().positive().optional(),
	options: z.record(z.string(), z.unknown()).optional(),
	failurePolicy: profileToolFailurePolicySchema,
});
export type ProfileToolEntry = z.infer<typeof profileToolEntrySchema>;

export const scanProfileSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	enabled: z.boolean(),
	defaultTimeoutSec: z.number().int().positive(),
	tools: z.array(profileToolEntrySchema),
});
export type ScanProfile = z.infer<typeof scanProfileSchema>;
