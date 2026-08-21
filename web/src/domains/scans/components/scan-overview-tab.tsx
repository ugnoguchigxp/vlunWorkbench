import type { Finding, ScanReview, ScanRun } from "../../../api";
import {
	buildScanWorkspaceViewModel,
	severityLabels,
} from "../scans-workspace-view-model";
import { FindingDetailPanel } from "./finding-detail-panel";
import { ScanImprovementRequestGenerator } from "./scan-improvement-request-generator";

export function ScanOverviewTab({
	findings,
	scanRuns,
	selectedScanRunId,
	coverageGaps,
	selectedFindingId,
	scanReviews,
	generatingImprovementRequest,
	automaticDiagnosticRunning,
	onSelectFinding,
	onCloseFinding,
	onGenerateImprovementRequest,
}: {
	findings: Finding[];
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	coverageGaps: number;
	selectedFindingId: string;
	scanReviews: ScanReview[];
	generatingImprovementRequest: boolean;
	automaticDiagnosticRunning: boolean;
	onSelectFinding: (findingId: string) => void;
	onCloseFinding: () => void;
	onGenerateImprovementRequest: () => void;
}) {
	const view = buildScanWorkspaceViewModel({
		findings,
		scanRuns,
		selectedScanRunId,
		coverageGaps,
	});
	return (
		<div className="workspace-overview" role="tabpanel">
			<section
				className="workspace-results-summary"
				aria-labelledby="workspace-latest-results"
			>
				<div className="workspace-results-summary-heading">
					<h2 id="workspace-latest-results">最新の結果</h2>
					<div
						className={`workspace-coverage-status ${view.coverageGaps === 0 ? "complete" : "attention"}`}
					>
						<span>カバレッジ</span>
						<strong>
							{view.coverageGaps === 0
								? "確認済み"
								: `${view.coverageGaps} 件の確認待ち`}
						</strong>
					</div>
				</div>
				<div className="workspace-results-summary-content">
					<div className="workspace-result-total">
						<strong>{view.selectedScan ? findings.length : "—"}</strong>
						<span>{view.selectedScan ? "検出結果" : "スキャン未選択"}</span>
					</div>
					<dl className="workspace-severity-summary">
						{Object.entries(view.severityCounts).map(([severity, count]) => (
							<div
								key={severity}
								className="workspace-severity-stat"
								data-severity={severity}
							>
								<dt>{severityLabels[severity as Finding["severity"]]}</dt>
								<dd>{count}</dd>
							</div>
						))}
					</dl>
				</div>
			</section>
			<section className="workspace-findings-section">
				<div className="workspace-section-heading">
					<h2>検出結果一覧</h2>
					<span>{findings.length} 件</span>
				</div>
				{findings.length ? (
					<div className="workspace-findings-list">
						{findings.map((finding) => (
							<button
								key={finding.id}
								type="button"
								aria-pressed={finding.id === selectedFindingId}
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
					<p className="workspace-empty">検出結果はありません。</p>
				)}
				<ScanImprovementRequestGenerator
					scanRun={view.selectedScan}
					findings={findings}
					reviews={scanReviews}
					generating={generatingImprovementRequest}
					automaticDiagnosticRunning={automaticDiagnosticRunning}
					onGenerate={onGenerateImprovementRequest}
				/>
			</section>
			{selectedFindingId ? (
				<div className="workspace-finding-detail">
					<FindingDetailPanel onClose={onCloseFinding} />
				</div>
			) : null}
		</div>
	);
}
