import type { Finding, ScanRun } from "../../../api";
import {
	buildScanWorkspaceViewModel,
	severityLabels,
} from "../scans-workspace-view-model";

export function ScanOverviewTab({
	findings,
	scanRuns,
	selectedScanRunId,
	coverageGaps,
	onSelectFinding,
}: {
	findings: Finding[];
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	coverageGaps: number;
	onSelectFinding: (findingId: string) => void;
}) {
	const view = buildScanWorkspaceViewModel({
		findings,
		scanRuns,
		selectedScanRunId,
		coverageGaps,
	});
	return (
		<div className="workspace-overview" role="tabpanel">
			<section className="workspace-summary-card prominent">
				<p>最新の結果</p>
				<strong>
					{view.selectedScan
						? `${findings.length} 件の検出結果`
						: "スキャン未選択"}
				</strong>
				<span>
					{view.selectedScan?.summary ??
						"スキャンを実行すると、ここに最新結果を表示します。"}
				</span>
				<div className="workspace-severity-row">
					{Object.entries(view.severityCounts).map(([severity, count]) => (
						<span key={severity} className={`severity-${severity}`}>
							{severityLabels[severity as Finding["severity"]]} {count}
						</span>
					))}
				</div>
			</section>
			<section className="workspace-summary-card">
				<p>カバレッジ</p>
				<strong>
					{view.coverageGaps === 0
						? "確認済み"
						: `${view.coverageGaps} 件の確認待ち`}
				</strong>
				<span>未走査・通信失敗・認証失敗を検出結果と分けて表示します。</span>
			</section>
			<section className="workspace-priority-findings">
				<div className="workspace-section-heading">
					<h2>優先して確認する検出結果</h2>
					<span>上位3件</span>
				</div>
				{view.priorityFindings.length ? (
					<div className="workspace-priority-list">
						{view.priorityFindings.map((finding) => (
							<button
								key={finding.id}
								type="button"
								onClick={() => onSelectFinding(finding.id)}
							>
								<span className={`severity-${finding.severity}`}>
									{severityLabels[finding.severity]}
								</span>
								<strong>{finding.title}</strong>
								<small>{finding.sourceTool}</small>
							</button>
						))}
					</div>
				) : (
					<p className="workspace-empty">表示できる検出結果はありません。</p>
				)}
			</section>
		</div>
	);
}
