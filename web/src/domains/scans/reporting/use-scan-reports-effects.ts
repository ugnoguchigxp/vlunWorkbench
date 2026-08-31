import { useEffect } from "react";
import { fetchScanReports, type ScanReport } from "../../../api";
import type { ScanDetailTab } from "../workspace/use-scan-launch-state";
import type { ScanReportsState } from "./use-scan-reports-state";

type ScanReportsEffectsScope = ScanReportsState & {
	active: boolean;
	scanDetailTab: ScanDetailTab;
	selectedScanRunId: string;
};

export function useScanReportsEffects(scope: ScanReportsEffectsScope) {
	const {
		active,
		scanDetailTab,
		selectedReport,
		selectedScanRunId,
		setReportPreviewContent,
		setReports,
		setSelectedReport,
	} = scope;

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setReports([]);
			setSelectedReport(null);
			setReportPreviewContent(null);
			return;
		}
		let mounted = true;
		void fetchScanReports(selectedScanRunId)
			.then((items: ScanReport[]) => {
				if (!mounted) return;
				setReports(items);
				setSelectedReport(items[0] ?? null);
				if (!items[0]) setReportPreviewContent(null);
			})
			.catch(() => {
				if (!mounted) return;
				setReports([]);
				setSelectedReport(null);
				setReportPreviewContent(null);
			});
		return () => {
			mounted = false;
		};
	}, [
		active,
		selectedScanRunId,
		setSelectedReport,
		setReportPreviewContent,
		setReports,
	]);

	useEffect(() => {
		if (
			!active ||
			scanDetailTab !== "report" ||
			!selectedReport ||
			selectedReport.status !== "completed"
		) {
			if (scanDetailTab === "report" || !selectedReport) {
				setReportPreviewContent(null);
			}
			return;
		}
		let mounted = true;
		void fetch(`/api/scan-reports/${selectedReport.id}/download`)
			.then((response) => (response.ok ? response.text() : null))
			.then((content) => {
				if (mounted) setReportPreviewContent(content);
			})
			.catch(() => {
				if (mounted) setReportPreviewContent(null);
			});
		return () => {
			mounted = false;
		};
	}, [active, scanDetailTab, selectedReport, setReportPreviewContent]);
}
