import { Download } from "lucide-react";
import type { Finding, ScanReview, ScanRun } from "../../../api";
import { buildScanFailureDisplay } from "../scan-failure-display";
import {
	buildScanWorkspaceViewModel,
	severityLabels,
} from "../scans-workspace-view-model";
import { FindingDetailPanel } from "./finding-detail-panel";
import { ScanFailurePanel } from "./scan-failure-panel";
import { ScanImprovementRequestGenerator } from "./scan-improvement-request-generator";

export function ScanOverviewTab({
	findings,
	scanRuns,
	selectedScanRunId,
	coverageGaps,
	selectedFindingId,
	scanReviews,
	generatingImprovementRequest,
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
	const scanActive =
		view.selectedScan?.status === "queued" ||
		view.selectedScan?.status === "running";
	const scanFailure = buildScanFailureDisplay(view.selectedScan);
	const scanNotStarted = scanFailure?.noScannerExecution === true;
	const scanIncomplete = scanFailure !== null;
	const coverageUnverified = !view.selectedScan || scanIncomplete;
	const scanResultsUnavailable = scanIncomplete && findings.length === 0;
	return (
		<div className="workspace-overview" role="tabpanel">
			<ScanFailurePanel scan={view.selectedScan} />
			<section
				className="workspace-results-summary"
				aria-labelledby="workspace-latest-results"
			>
				<div className="workspace-results-summary-heading">
					<h2 id="workspace-latest-results">最新の結果</h2>
					<div
						className={`workspace-coverage-status ${coverageUnverified ? "unknown" : view.coverageGaps === 0 ? "complete" : "attention"}`}
					>
						<span>カバレッジ</span>
						<strong>
							{coverageUnverified
								? view.selectedScan
									? "未確定"
									: "未確認"
								: view.coverageGaps === 0
									? "確認済み"
									: `${view.coverageGaps} 件の確認待ち`}
						</strong>
					</div>
				</div>
				<div className="workspace-results-summary-content">
					<div className="workspace-result-total">
						<strong>
							{view.selectedScan && !scanResultsUnavailable
								? findings.length
								: "—"}
						</strong>
						<span>
							{scanNotStarted
								? "検査未実施"
								: scanIncomplete
									? findings.length > 0
										? "暫定結果"
										: "結果未確定"
									: view.selectedScan
										? "検出結果"
										: "スキャン未選択"}
						</span>
					</div>
					{scanResultsUnavailable ? (
						<p className="workspace-results-unavailable">
							{scanNotStarted
								? "スキャン未実施のため、重要度別の検出数を集計できません。"
								: "スキャンが完了していないため、重要度別の検出数は確定していません。"}
						</p>
					) : (
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
					)}
				</div>
			</section>
			<section className="workspace-findings-section">
				<div className="workspace-section-heading">
					<h2>検出結果一覧</h2>
					<div className="workspace-section-actions">
						<span>
							{scanResultsUnavailable
								? "—"
								: scanIncomplete
									? `${findings.length} 件（暫定）`
									: `${findings.length} 件`}
						</span>
						{view.selectedScan && !scanResultsUnavailable ? (
							<a
								className="ds-button demo-button secondary workspace-results-download"
								href={`/api/scans/${encodeURIComponent(view.selectedScan.id)}/findings/download`}
								download
							>
								<Download size={14} aria-hidden="true" />
								結果をダウンロード
							</a>
						) : null}
					</div>
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
				) : !view.selectedScan ? (
					<p className="workspace-empty">
						スキャンを選択すると検出結果を確認できます。
					</p>
				) : scanActive ? (
					<p className="workspace-empty" role="status">
						スキャン中です。収集済みの検出結果を随時更新します。
					</p>
				) : scanNotStarted ? (
					<p className="workspace-empty">
						スキャナーが開始されていないため、検出結果の有無は確認できません。
					</p>
				) : scanIncomplete ? (
					<p className="workspace-empty">
						スキャンが完了していないため、検出結果の有無は確定していません。
					</p>
				) : (
					<p className="workspace-empty">検出結果はありません。</p>
				)}
				{scanResultsUnavailable ? null : (
					<ScanImprovementRequestGenerator
						scanRun={view.selectedScan}
						findings={findings}
						reviews={scanReviews}
						generating={generatingImprovementRequest}
						onGenerate={onGenerateImprovementRequest}
					/>
				)}
			</section>
			{selectedFindingId ? (
				<div className="workspace-finding-detail">
					<FindingDetailPanel onClose={onCloseFinding} />
				</div>
			) : null}
		</div>
	);
}
