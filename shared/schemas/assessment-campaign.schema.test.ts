import { describe, expect, test } from "vitest";
import { assessmentCampaignCatalogEntrySchema } from "./assessment-campaign.schema";

const base = {
	schemaVersion: 1 as const,
	id: "professional-full" as const,
	displayName: "Professional full",
	description: "Qualified child runs plus human review.",
	availability: "planned" as const,
	launchMode: "unavailable" as const,
	childProfileIds: ["source-assurance" as const],
	capabilityRequirements: [],
	humanReviewRequired: true as const,
	limitationCodes: ["human_review_required"],
};

describe("assessment campaign schema", () => {
	test("rejects duplicate child profiles and limitation codes", () => {
		expect(
			assessmentCampaignCatalogEntrySchema.safeParse({
				...base,
				childProfileIds: ["source-assurance", "source-assurance"],
			}).success,
		).toBe(false);
		expect(
			assessmentCampaignCatalogEntrySchema.safeParse({
				...base,
				limitationCodes: [
					"human_review_required",
					"human_review_required",
				],
			}).success,
		).toBe(false);
	});
});
