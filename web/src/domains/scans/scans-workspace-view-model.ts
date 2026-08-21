import type { Finding, ScanRun } from "../../api";

export const severityLabels: Record<Finding["severity"], string> = {
	critical: "緊急",
	high: "高",
	medium: "中",
	low: "低",
	info: "情報",
	unknown: "不明",
};

export function buildScanWorkspaceViewModel(params: {
	findings: Finding[];
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	coverageGaps: number;
}) {
	const severityCounts = Object.fromEntries(
		Object.keys(severityLabels).map((severity) => [severity, 0]),
	) as Record<Finding["severity"], number>;
	for (const finding of params.findings) severityCounts[finding.severity] += 1;
	const selectedScan =
		params.scanRuns.find((scan) => scan.id === params.selectedScanRunId) ??
		null;
	return {
		severityCounts,
		selectedScan,
		hasScans: params.scanRuns.length > 0,
		coverageGaps: params.coverageGaps,
	};
}
