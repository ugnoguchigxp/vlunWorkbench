import { CheckCircle2, Circle, Download, FileText } from "lucide-react";
import { useScans } from "../scans-context";
import { shortPath } from "../scans-utils";
import { DECISION_STATE_LABELS, REASON_LABELS } from "./finding-detail-labels";

export function DecisionCompletenessSummary() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="decision-summary-panel">
			<div>
				<span className="scan-review-context-label">実装改善handoff</span>
				<strong>{DECISION_STATE_LABELS[workflow.decisionState]}</strong>
			</div>
			<div>
				<span className="scan-review-context-label">
					LLM にリスクを渡す前に不足している自動診断情報
				</span>
				<strong>
					{workflow.missingInputs.length > 0
						? workflow.missingInputs.join(", ")
						: "なし"}
				</strong>
			</div>
			{workflow.recommendedReason ? (
				<div>
					<span className="scan-review-context-label">補足理由</span>
					<strong>{REASON_LABELS[workflow.recommendedReason]}</strong>
				</div>
			) : null}
		</div>
	);
}

export function EvidenceQualityPanel() {
	const quality = useScans().selectedEvidenceQuality;
	if (!quality) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">証跡品質</h3>
			<div className="evidence-quality-panel">
				<div className="evidence-quality-score">
					<span className={`evidence-quality-badge evidence-${quality.level}`}>
						{quality.label}
					</span>
					<span
						className={`evidence-quality-badge evidence-completeness-${quality.dataCompleteness}`}
					>
						{quality.dataCompletenessLabel}
					</span>
					<strong>{quality.score}/100</strong>
				</div>
				<div className="evidence-quality-reasons">
					{quality.reasons.slice(0, 3).map((reason) => (
						<small key={reason}>{reason}</small>
					))}
				</div>
				<div className="evidence-signal-list">
					{[...quality.presentSignals, ...quality.missingSignals].map(
						(signal) => (
							<div
								key={signal.id}
								className={`evidence-signal signal-${signal.present ? "present" : "missing"}`}
							>
								{signal.present ? (
									<CheckCircle2 className="icon" />
								) : (
									<Circle className="icon" />
								)}
								<span>
									<strong>{signal.label}</strong>
									<small>{signal.reference ?? signal.strength}</small>
								</span>
							</div>
						),
					)}
				</div>
			</div>
		</div>
	);
}

export function EvidenceChecklistPanel() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">自動診断材料チェックリスト</h3>
			<div className="evidence-checklist">
				{workflow.evidenceChecklist.map((item) => (
					<div
						key={item.id}
						className={`evidence-checklist-item ${item.available ? "available" : "missing"}`}
					>
						{item.available ? (
							<CheckCircle2 className="icon" />
						) : (
							<Circle className="icon" />
						)}
						<div>
							<strong>{item.label}</strong>
							<small>{item.reference ?? "未読み込みまたは未記録"}</small>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

export function SourceEvidenceDetail() {
	const c = useScans();
	const details = c.selectedFindingDetails;
	if (!details) return null;
	const finding = details.finding;
	const sourceEvidence = details.evidence.find(
		(item) => item.kind === "source-location",
	);
	const location = finding.primaryLocation ?? sourceEvidence?.location;
	const sourceSnippet =
		sourceEvidence?.snippet ||
		(typeof finding.metadata?.snippet === "string"
			? finding.metadata.snippet
			: "") ||
		"";
	const locationPath =
		location && typeof location.path === "string" ? location.path : "";
	const locationLine =
		location &&
		(typeof location.startLine === "number" ||
			typeof location.startLine === "string")
			? String(location.startLine)
			: "";
	return (
		<>
			{locationPath || sourceSnippet ? (
				<div className="detail-section">
					<h3 className="detail-section-title">主な検出位置</h3>
					<div className="code-snippet-box">
						<div className="code-snippet-header">
							<div className="code-snippet-title">
								{locationPath
									? `${shortPath(locationPath)}${locationLine ? `#L${locationLine}` : ""}`
									: sourceEvidence?.title || "記録済みのソーススニペット"}
							</div>
						</div>
						<pre className="code-snippet-body">
							<code>{sourceSnippet || "// スニペットは利用できません"}</code>
						</pre>
					</div>
				</div>
			) : null}
			{details.evidence.some((item) => item.artifactId) ? (
				<div className="detail-section">
					<h3 className="detail-section-title">スキャン証跡</h3>
					<div className="finding-meta-row">
						{details.evidence
							.filter((item) => item.artifactId)
							.map((item) => (
								<a
									key={item.id}
									href={`/api/scans/${finding.scanRunId}/artifacts/${item.artifactId}/download`}
									target="_blank"
									rel="noreferrer"
								>
									<Download size={12} />
									{item.title || `artifact ${item.artifactId?.slice(0, 8)}`}
								</a>
							))}
					</div>
				</div>
			) : null}
		</>
	);
}

export function ReportImpactPreview() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<FileText className="icon" /> レポートへの反映
			</h3>
			<div className="report-impact-panel">
				<div>
					<span className="scan-review-context-label">
						レポート上の互換分類
					</span>
					<span
						className={`decision-badge badge-${workflow.reportImpact.bucket}`}
					>
						{workflow.reportImpact.label}
					</span>
				</div>
				<div>
					<span className="scan-review-context-label">既定の出力対象</span>
					<strong>
						{workflow.reportImpact.includedByDefault
							? "生成される Markdown に含まれます"
							: "現在のレポート設定では除外されます"}
					</strong>
				</div>
				<div>
					<span className="scan-review-context-label">
						互換用 Decision 記録
					</span>
					<strong>
						{workflow.latestDecision
							? REASON_LABELS[workflow.latestDecision.reason]
							: "通常フローでは入力不要です。LLM handoff を生成してください"}
					</strong>
				</div>
			</div>
		</div>
	);
}
