import { Hono } from "hono";
import { listAssessmentCampaignCatalogEntries } from "../modules/scans/assessment-campaign-catalog";

export function createAssessmentCampaignsRoute() {
	return new Hono().get("/", (c) =>
		c.json({
			schemaVersion: 1,
			campaigns: listAssessmentCampaignCatalogEntries(),
		}),
	);
}
