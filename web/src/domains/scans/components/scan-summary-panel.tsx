import { useScans } from "../scans-context";
import { getSeverityClass } from "../scans-utils";

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
			<div className="detail-section">
				<span className={`scan-status-badge badge-${summary.profileOutcome}`}>
					Outcome: {summary.profileOutcome.replace(/_/g, " ").toUpperCase()}
				</span>
				<h2>Scan Profile Summary</h2>
				<p>Profile: {summary.profileId}</p>
			</div>
			<div className="detail-section">
				<h3 className="detail-section-title">Tool Results</h3>
				{summary.tools.map((tool) => (
					<div className="assessment-card" key={tool.toolId}>
						<div className="finding-meta-row">
							<strong>{tool.toolId}</strong>
							<span className={`scan-status-badge badge-${tool.status}`}>
								{tool.status}
							</span>
						</div>
						{tool.status === "completed" ? (
							<div className="assessment-grid">
								<Metric label="Findings" value={tool.findingCount} />
								<Metric label="Artifacts" value={tool.artifactCount} />
								<Metric label="Exit Code" value={tool.exitCode ?? 0} />
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
										{severity}: {count}
									</span>
								))}
						</div>
						{tool.error ? <p className="badge-failed">{tool.error}</p> : null}
					</div>
				))}
			</div>
			<div className="assessment-grid">
				<Metric label="Total Findings" value={summary.totals.findingCount} />
				<Metric label="Total Artifacts" value={summary.totals.artifactCount} />
				<Metric
					label="Reviewed Findings"
					value={summary.totals.reviewedFindingCount}
				/>
				<Metric
					label="Decided Findings"
					value={summary.totals.decidedFindingCount}
				/>
			</div>
			<div className="detail-section">
				<h3 className="detail-section-title">Diagnostic Coverage</h3>
				{summary.totals.findingCount === 0 ? (
					<p>
						No normalized findings were produced. Review diagnostic coverage
						before treating this scan as low risk.
					</p>
				) : null}
				<div className="assessment-grid">
					<Metric label="Attack Surface" value={c.attackSurfaceItems.length} />
					<Metric
						label="Security Checks"
						value={c.securityCheckResults.length}
					/>
					<Metric
						label="Manual Review"
						value={checkStatusCounts.manual_review ?? 0}
					/>
					<Metric
						label="Not Checked"
						value={checkStatusCounts.not_checked ?? 0}
					/>
				</div>
				<div className="finding-meta-row">
					<button
						type="button"
						className="demo-button secondary"
						disabled={c.diagnosticLoading}
						onClick={c.handleRunDiagnostics}
					>
						{c.diagnosticLoading ? "Running..." : "Run Diagnostics"}
					</button>
					<button
						type="button"
						className="demo-button secondary"
						disabled={c.diagnosticLoading}
						onClick={c.handleGenerateDiagnosticReport}
					>
						Generate Diagnostic Report
					</button>
					{latestDiagnosticReport?.status === "completed" ? (
						<a
							href={`/api/diagnostic-reports/${latestDiagnosticReport.id}/download`}
							download
						>
							Download Diagnostic Report
						</a>
					) : null}
				</div>
				{latestDiagnosticReport ? (
					<div className="assessment-card">
						<strong>
							Latest diagnostic report: {latestDiagnosticReport.status}
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
