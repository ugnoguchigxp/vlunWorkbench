import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
const environmentKeySchema = z.enum([
	"linux/x64+linux/amd64",
	"darwin/arm64+linux/arm64",
]);
const promotableProfileIdSchema = z.enum([
	"api-readonly",
	"remediation-verification",
	"dynamic-verification",
	"authenticated-web",
	"active-technical-lab",
	"business-logic-lab",
]);

export const scanProfilePromotionManifestV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		candidateCommit: commitSchema,
		promotions: z
			.array(
				z
					.object({
						profileId: promotableProfileIdSchema,
						fromAvailability: z.literal("experimental"),
						toAvailability: z.literal("stable"),
						requiredEnvironments: z.array(environmentKeySchema).length(2),
						qualificationReceiptHashes: z.array(sha256DigestSchema).length(2),
					})
					.strict(),
			)
			.min(1),
		verdict: z.literal("passed"),
		manifestHash: sha256DigestSchema,
	})
	.strict()
	.superRefine((value, ctx) => {
		const profileIds = value.promotions.map((promotion) => promotion.profileId);
		if (new Set(profileIds).size !== profileIds.length)
			ctx.addIssue({
				code: "custom",
				path: ["promotions"],
				message: "promotion_profile_duplicate",
			});
		for (const promotion of value.promotions) {
			if (new Set(promotion.requiredEnvironments).size !== 2)
				ctx.addIssue({
					code: "custom",
					path: ["promotions"],
					message: "promotion_environment_duplicate",
				});
			if (
				promotion.requiredEnvironments.join("\0") !==
				[...promotion.requiredEnvironments].sort().join("\0")
			)
				ctx.addIssue({
					code: "custom",
					path: ["promotions"],
					message: "promotion_environments_not_sorted",
				});
		}
	});

export type ScanProfilePromotionManifestV1 = z.infer<
	typeof scanProfilePromotionManifestV1Schema
>;
