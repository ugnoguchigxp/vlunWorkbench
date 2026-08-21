import { fetchScanReports, generateScanReport } from "../../../api";
import type { ScansActionScope } from "../workspace/scans-action-scope";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};

export function buildScanReportingActions(scope: ScansActionScope) {
	const {
		getReportQualityPreview,
		selectedScanRunId,
		setErrorText,
		setReportLoading,
		setReports,
		setScanDetailTab,
		setSelectedReport,
	} = scope;

	const handleGenerateReport = async (
		summaryMode:
			| "deterministic"
			| "deterministic_with_llm_summary" = "deterministic",
		scanRunId = selectedScanRunId,
	) => {
		if (!scanRunId) return;
		setReportLoading(true);
		setErrorText(null);
		try {
			const defaultTitle =
				scanRunId === selectedScanRunId
					? getReportQualityPreview().recommendedReportTitle
					: `セキュリティレポート - ${scanRunId.slice(0, 8)}`;
			const res = await generateScanReport(scanRunId, {
				format: "markdown",
				title: defaultTitle,
				...DEFAULT_REPORT_OPTIONS,
				summaryMode,
			});
			const list = await fetchScanReports(scanRunId);
			setReports(list);
			setSelectedReport(
				list.find((item) => item.id === res.report.id) ?? res.report,
			);
			setScanDetailTab("report");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "レポート生成に失敗しました。",
			);
		} finally {
			setReportLoading(false);
		}
	};

	return { handleGenerateReport };
}
