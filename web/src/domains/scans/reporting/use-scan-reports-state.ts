import { useState } from "react";
import type { ScanReport } from "../../../api";

export function useScanReportsState() {
	const [reportLoading, setReportLoading] = useState(false);
	const [reports, setReports] = useState<ScanReport[]>([]);
	const [selectedReport, setSelectedReport] = useState<ScanReport | null>(null);
	const [reportPreviewContent, setReportPreviewContent] = useState<
		string | null
	>(null);

	return {
		reportLoading,
		reportPreviewContent,
		reports,
		selectedReport,
		setReportLoading,
		setReportPreviewContent,
		setReports,
		setSelectedReport,
	};
}

export type ScanReportsState = ReturnType<typeof useScanReportsState>;
