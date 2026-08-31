import { z } from "zod";
import { scanCapabilityRequirementsSchema } from "./scan-capability.schema";
import { canonicalProfileIdSchema } from "./scan-profile-definition.schema";

export const assessmentCampaignIdSchema = z.enum(["professional-full"]);
export type AssessmentCampaignId = z.infer<typeof assessmentCampaignIdSchema>;

export const assessmentCampaignCatalogEntrySchema = z
	.object({
		schemaVersion: z.literal(1),
		id: assessmentCampaignIdSchema,
		displayName: z.string().min(1).max(160),
		description: z.string().min(1).max(1000),
		availability: z.enum(["planned", "experimental", "stable"]),
		launchMode: z.enum(["campaign_coordinator", "unavailable"]),
		childProfileIds: z.array(canonicalProfileIdSchema).min(1).max(32),
		capabilityRequirements: scanCapabilityRequirementsSchema,
		humanReviewRequired: z.literal(true),
		limitationCodes: z.array(z.string().min(1).max(100)).max(32),
	})
	.strict()
	.superRefine((value, context) => {
		for (const [field, entries] of [
			["childProfileIds", value.childProfileIds],
			["limitationCodes", value.limitationCodes],
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
export type AssessmentCampaignCatalogEntry = z.infer<
	typeof assessmentCampaignCatalogEntrySchema
>;
