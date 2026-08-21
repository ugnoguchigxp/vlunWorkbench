import type { ReportReadiness, ReportSubmissionLevel } from "./report-quality";

export const reportSubmissionLevelLabels: Record<
	ReportSubmissionLevel,
	{
		primaryActionLabel: string;
		secondaryStatusLabel: string;
		toolbarActionLabel: string;
	}
> = {
	submission_ready: {
		primaryActionLabel: "提出用レポートを生成",
		secondaryStatusLabel: "提出準備完了",
		toolbarActionLabel: "提出用レポートを生成",
	},
	internal_review: {
		primaryActionLabel: "内部レビュー用ドラフトを生成",
		secondaryStatusLabel: "内部レビュー用ドラフト",
		toolbarActionLabel: "内部レビュー用ドラフトを生成",
	},
	incomplete: {
		primaryActionLabel: "レビュー用ドラフトを生成",
		secondaryStatusLabel: "追加確認が必要",
		toolbarActionLabel: "レビュー用ドラフトを生成",
	},
};

export const getReportSubmissionLevel = (
	readiness: ReportReadiness,
): ReportSubmissionLevel => {
	if (readiness === "ready") return "submission_ready";
	if (readiness === "partial") return "internal_review";
	return "incomplete";
};

export const buildGenerationWarning = (input: {
	readiness: ReportReadiness;
	missingInputs: string[];
	partialReasons: string[];
}): string | null => {
	void input;
	return null;
};

export const getReportReadinessCopy = (
	submissionLevel: ReportSubmissionLevel,
) => reportSubmissionLevelLabels[submissionLevel];
