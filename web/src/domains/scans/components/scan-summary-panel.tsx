import { useScans } from "../scans-context";
import { getSeverityClass } from "../scans-utils";

export function ScanSummaryPanel() {
	const summary = useScans().scanSummary;
	if (!summary) return null;
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
