import type { ScanReport, ScanReview } from "../../../api";

export const selectWorkspaceReportId = (
	reports: ScanReport[],
	requestedReportId?: string,
): string | null => {
	if (
		requestedReportId &&
		reports.some((report) => report.id === requestedReportId)
	) {
		return requestedReportId;
	}
	return (
		reports.find(
			(report) =>
				report.status === "completed" && report.stage === "canonical_final",
		)?.id ?? null
	);
};

export const hasLlmComment = (review: ScanReview | null): boolean =>
	Boolean(
		review?.status === "completed" &&
			(review.riskOverview ||
				review.summary ||
				review.priorityNotes.length ||
				review.recommendedNextActions.length),
	);

export const llmCommentTitle = (review: ScanReview | null): string =>
	review?.riskOverview ?? review?.summary ?? "LLMコメントはありません。";
