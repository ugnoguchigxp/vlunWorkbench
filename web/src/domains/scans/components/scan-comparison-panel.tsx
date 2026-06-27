import { ArrowRightLeft } from "lucide-react";
import { useScans } from "../scans-context";
import { getSeverityClass } from "../scans-utils";

const statusLabels = {
	available: "Baseline available",
	missing_baseline: "No baseline",
	insufficient_data: "Baseline loading",
} as const;

export function ScanComparisonPanel() {
	const c = useScans();
	const comparison = c.scanComparison;
	return (
		<section className="decision-grade-panel comparison-panel">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">Scan comparison</span>
					<h3>
						<ArrowRightLeft className="icon" />
						{statusLabels[comparison.status]}
					</h3>
				</div>
				{comparison.baselineScanRunId ? (
					<code>{comparison.baselineScanRunId.slice(0, 8)}</code>
				) : null}
			</div>
			<div className="decision-grade-metrics">
				<Metric label="New" value={comparison.counts.new} />
				<Metric label="Resolved" value={comparison.counts.resolved} />
				<Metric label="Unchanged" value={comparison.counts.unchanged} />
				<Metric label="Regressed" value={comparison.counts.regressed} />
			</div>
			{comparison.deltas.length > 0 ? (
				<div className="comparison-delta-list">
					{comparison.deltas.slice(0, 5).map((delta) => (
						<button
							type="button"
							key={delta.id}
							disabled={!delta.currentFindingId}
							onClick={() =>
								delta.currentFindingId
									? c.handleSelectFinding(delta.currentFindingId)
									: null
							}
						>
							<span
								className={`severity-badge ${getSeverityClass(delta.severity)}`}
							>
								{delta.severity}
							</span>
							<span>
								<strong>
									{delta.kind}: {delta.title}
								</strong>
								<small>{delta.reason}</small>
							</span>
						</button>
					))}
				</div>
			) : (
				<p>
					{comparison.status === "missing_baseline"
						? "同一 profile の以前の scan run はまだありません。"
						: "比較に使える finding delta はありません。"}
				</p>
			)}
		</section>
	);
}

function Metric({ label, value }: { label: string; value: number }) {
	return (
		<div className="decision-grade-metric">
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}
