import type {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
} from "../../db/schema";

export type StaticIntelligenceProjectRow = typeof projects.$inferSelect;
export type StaticIntelligenceScanRunRow = typeof scanRuns.$inferSelect;
export type StaticIntelligenceToolRunRow = typeof toolRuns.$inferSelect;
export type StaticIntelligenceArtifactRow = typeof scanArtifacts.$inferSelect;
export type StaticIntelligenceFindingRow = typeof findings.$inferSelect;
export type StaticIntelligenceEvidenceRow =
	typeof findingEvidences.$inferSelect;
export type StaticIntelligenceScanReviewRow = typeof scanReviews.$inferSelect;

export type StaticIntelligenceSourceBundle = {
	project: StaticIntelligenceProjectRow;
	scanRun: StaticIntelligenceScanRunRow;
	toolRuns: StaticIntelligenceToolRunRow[];
	artifacts: StaticIntelligenceArtifactRow[];
	findings: StaticIntelligenceFindingRow[];
	evidences: StaticIntelligenceEvidenceRow[];
	latestReview: StaticIntelligenceScanReviewRow | null;
	latestCompletedReview: StaticIntelligenceScanReviewRow | null;
};
