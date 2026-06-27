import { ArrowRightLeft } from "lucide-react";
import { formatSeverityLabel } from "../scan-display-copy";
import { useScans } from "../scans-context";
import { getSeverityClass } from "../scans-utils";

const statusLabels = {
	available: "baseline あり",
	missing_baseline: "baseline なし",
	insufficient_data: "baseline 読み込み中",
} as const;

const confidenceLabels = {
	stable: "安定 ID",
	fingerprint: "fingerprint",
	rule_location: "rule/location",
	insufficient: "照合キー不足",
} as const;

const deltaKindLabels = {
	new: "新規",
	resolved: "解消",
	unchanged: "変化なし",
	regressed: "悪化",
} as const;

export function ScanComparisonPanel() {
	const c = useScans();
	const comparison = c.scanComparison;
	return (
		<section className="decision-grade-panel comparison-panel">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">スキャン比較</span>
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
				<Metric label="新規" value={comparison.counts.new} />
				<Metric label="解消" value={comparison.counts.resolved} />
				<Metric label="変化なし" value={comparison.counts.unchanged} />
				<Metric label="悪化" value={comparison.counts.regressed} />
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
								{formatSeverityLabel(delta.severity)}
							</span>
							<span>
								<strong>
									{deltaKindLabels[delta.kind]}: {delta.title}
								</strong>
								<small>{delta.reason}</small>
								<small>
									照合: {confidenceLabels[delta.matchConfidence]} -{" "}
									{delta.matchReason}
								</small>
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
