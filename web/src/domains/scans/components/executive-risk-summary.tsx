import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { useScans } from "../scans-context";

export function ExecutiveRiskSummary() {
	const c = useScans();
	const summary = c.executiveRiskSummary;
	return (
		<section className={`decision-grade-panel risk-${summary.riskBand}`}>
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">Risk summary</span>
					<h3>
						<AlertTriangle className="icon" />
						{summary.riskBand.toUpperCase()} / {summary.score}
					</h3>
				</div>
				<ShieldCheck className="decision-grade-head-icon" />
			</div>
			<p>{summary.headline}</p>
			<div className="decision-grade-metrics">
				<Metric label="Strong evidence" value={summary.counts.strongEvidence} />
				<Metric
					label="Weak/missing"
					value={summary.counts.weakOrMissingEvidence}
				/>
				<Metric label="Needs fix" value={summary.counts.needsFix} />
				<Metric label="Accepted" value={summary.counts.acceptedRisk} />
			</div>
			{summary.recommendedFocus.length > 0 ? (
				<div className="decision-grade-list">
					{summary.recommendedFocus.map((item) => (
						<button
							type="button"
							key={item.findingId || item.title}
							onClick={() =>
								item.findingId ? c.handleSelectFinding(item.findingId) : null
							}
							disabled={!item.findingId}
						>
							<span>
								<strong>{item.title}</strong>
								<small>{item.reason}</small>
							</span>
							{item.findingId ? <ArrowRight className="icon" /> : null}
						</button>
					))}
				</div>
			) : null}
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
