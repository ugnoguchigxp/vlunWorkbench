import type { Finding, ScanRun } from "../../api";

const severityOrder: Record<Finding["severity"], number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

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
	const priorityFindings = [...params.findings]
		.sort((left, right) => {
			const severityDelta =
				severityOrder[left.severity] - severityOrder[right.severity];
			if (severityDelta !== 0) return severityDelta;
			const confidenceDelta = left.confidence.localeCompare(right.confidence);
			if (confidenceDelta !== 0) return confidenceDelta;
			return left.id.localeCompare(right.id);
		})
		.slice(0, 3);
	const selectedScan =
		params.scanRuns.find((scan) => scan.id === params.selectedScanRunId) ?? null;
	return {
		severityCounts,
		priorityFindings,
		selectedScan,
		hasScans: params.scanRuns.length > 0,
		coverageGaps: params.coverageGaps,
	};
}
