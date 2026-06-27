import { useScans } from "../scans-context";
import { formatScanOutcome, getToolDisplay } from "../scan-profile-display";
import { formatSeverityLabel } from "../scan-display-copy";
import { getSeverityClass } from "../scans-utils";
import { ScanResultOverview } from "./scan-result-overview";

export function ScanSummaryPanel() {
	const c = useScans();
	const summary = c.scanSummary;
	if (!summary) return null;
	const latestDiagnosticReport = c.diagnosticReports[0] ?? null;
	const checkStatusCounts = c.securityCheckResults.reduce<
		Record<string, number>
	>((counts, result) => {
		counts[result.status] = (counts[result.status] ?? 0) + 1;
		return counts;
	}, {});
	return (
		<div className="scans-detail-scroll">
			<ScanResultOverview />
			<div className="detail-section">
				<span className={`scan-status-badge badge-${summary.profileOutcome}`}>
					総合結果: {formatScanOutcome(summary.profileOutcome)}
				</span>
				<h2>スキャン別の詳細結果</h2>
			</div>
			<div className="detail-section">
				<h3 className="detail-section-title">実行した ScanProfile step</h3>
				{summary.steps?.length ? (
					<div className="assessment-grid">
						{summary.steps.map((step) => (
							<div className="assessment-card" key={step.id}>
								<div className="finding-meta-row">
									<div>
										<strong>{step.displayName}</strong>
										<p className="scan-tool-purpose">
											{step.kind === "dast"
												? step.targetOrigin
													? `HTTP実行対象: ${step.targetOrigin}`
													: "HTTP実行対象: 自動判別"
												: getToolDisplay(step.id).purpose}
										</p>
									</div>
									<span className={`scan-status-badge badge-${step.status}`}>
										{formatScanOutcome(step.status)}
									</span>
								</div>
								<div className="finding-meta-row">
									<span>検出数: {step.findingCount}</span>
									<span>証跡: {step.artifactCount}</span>
								</div>
								{step.kind === "dast" && step.outcome ? (
									<p>DAST outcome: {formatScanOutcome(step.outcome)}</p>
								) : null}
								{step.error ? (
									<p className="badge-failed">
										{step.kind === "dast"
											? `実行時診断の未確認項目: ${step.error}`
											: step.error}
									</p>
								) : null}
							</div>
						))}
					</div>
				) : null}
			</div>
			<div className="detail-section">
				<h3 className="detail-section-title">静的 tool 詳細</h3>
				{summary.tools.map((tool) => {
					const display = getToolDisplay(tool.toolId);
					return (
						<div className="assessment-card" key={tool.toolId}>
							<div className="finding-meta-row">
								<div>
									<strong>{display.name}</strong>
									<p className="scan-tool-purpose">{display.purpose}</p>
								</div>
								<span className={`scan-status-badge badge-${tool.status}`}>
									{formatScanOutcome(tool.status)}
								</span>
							</div>
							{tool.status === "completed" ? (
								<div className="assessment-grid">
									<Metric label="検出数" value={tool.findingCount} />
									<Metric label="証跡" value={tool.artifactCount} />
									<Metric label="終了コード" value={tool.exitCode ?? 0} />
								</div>
							) : null}
							<div className="finding-meta-row">
								{Object.entries(tool.severityCounts || {})
									.filter(([, count]) => count > 0)
									.map(([severity, count]) => (
										<span
											key={severity}
											className={`severity-badge ${getSeverityClass(severity)}`}
										>
											{formatSeverityLabel(severity)}: {count}
										</span>
									))}
							</div>
							{tool.error ? <p className="badge-failed">{tool.error}</p> : null}
						</div>
					);
				})}
			</div>
			<div className="detail-section">
				<h3 className="detail-section-title">診断カバレッジ</h3>
				{summary.totals.findingCount === 0 ? (
					<p>
						正規化された finding
						はありません。低リスクと扱う前に、診断カバレッジと証跡を LLM handoff
						に含めてください。
					</p>
				) : null}
				<div className="assessment-grid">
					<Metric label="攻撃面" value={c.attackSurfaceItems.length} />
					<Metric
						label="セキュリティ検査"
						value={c.securityCheckResults.length}
					/>
					<Metric
						label="追加確認"
						value={checkStatusCounts.manual_review ?? 0}
					/>
					<Metric label="未確認" value={checkStatusCounts.not_checked ?? 0} />
				</div>
				<div className="finding-meta-row">
					<button
						type="button"
						className="demo-button secondary"
						disabled={c.diagnosticLoading}
						onClick={c.handleRunDiagnostics}
					>
						{c.diagnosticLoading ? "診断中..." : "診断を実行"}
					</button>
					<button
						type="button"
						className="demo-button secondary"
						disabled={c.diagnosticLoading}
						onClick={c.handleGenerateDiagnosticReport}
					>
						診断レポートを生成
					</button>
					{latestDiagnosticReport?.status === "completed" ? (
						<a
							href={`/api/diagnostic-reports/${latestDiagnosticReport.id}/download`}
							download
						>
							診断レポートをダウンロード
						</a>
					) : null}
				</div>
				{latestDiagnosticReport ? (
					<div className="assessment-card">
						<strong>
							最新の診断レポート:{" "}
							{formatScanOutcome(latestDiagnosticReport.status)}
						</strong>
						<p>{latestDiagnosticReport.summary}</p>
					</div>
				) : null}
			</div>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className="assessment-card">
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}
