import { describe, expect, test } from "bun:test";
import { createAssessmentCampaignsRoute } from "./assessment-campaigns.route";

describe("assessment campaign catalog route", () => {
	test("publishes professional-full outside the scan profile catalog", async () => {
		const response = await createAssessmentCampaignsRoute().request("/");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.campaigns).toEqual([
			expect.objectContaining({
				id: "professional-full",
				availability: "planned",
				launchMode: "unavailable",
				humanReviewRequired: true,
			}),
		]);
	});
});
