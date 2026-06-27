import { CheckCircle2, Circle, Download, FileText, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { SelectInput } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime, getSeverityClass, shortPath } from "../scans-utils";
import { actionQueueStateLabel, type FindingWorkState } from "../work-states";
import { DecisionSection } from "./decision-section";
import { RemediationPlanSection } from "./remediation-plan-section";
import { ReportDetailPanel } from "./report-detail-panel";
import { ReviewSection } from "./review-section";
import { ScanResultOverview } from "./scan-result-overview";
import { ScanSummaryPanel } from "./scan-summary-panel";
import { VerificationSections } from "./verification-sections";
import { ZeroFindingDiagnosticPanel } from "./zero-finding-diagnostic-panel";

const DECISION_STATE_LABELS = {
	missing: "判断未記録",
	complete: "判断記録済み",
	needs_context: "追加情報が必要",
} as const;

const DECISION_LABELS = {
	accepted: "リスク受容",
	false_positive: "誤検知",
	deferred: "保留",
	needs_fix: "要修正",
	open: "未判断",
} as const;

const REASON_LABELS = {
	confirmed_by_evidence: "証跡で確認済み",
	confirmed_by_review: "レビューで確認済み",
	insufficient_evidence: "証跡不足",
	environment_specific: "環境依存",
	tool_noise: "ツールのノイズ",
	not_exploitable: "悪用困難",
	accepted_risk: "リスク受容",
	other: "その他",
} as const;

export function FindingDetailPanel() {
	const c = useScans();
	return (
		<section className="scans-panel scans-detail-col">
			<div className="scans-panel-header scan-detail-header">
				<div className="scan-detail-heading-copy">
					<h2>Finding 分析と LLM レビュー</h2>
					<p>
						選択中のスキャンが何を確認したものか、その結果として出た
						finding、LLM レビュー、検証、レポートを確認します。
					</p>
					{c.selectedScanRunId ? (
						<small>
							finding {c.displayedFindings.length} 件 / report{" "}
							{c.reports.length} 件
						</small>
					) : null}
				</div>
				<div
					className="scan-detail-tabs"
					role="tablist"
					aria-label="スキャン結果ビュー"
				>
					<button
						type="button"
						className={c.scanDetailTab === "review" ? "active" : ""}
						onClick={() => c.setScanDetailTab("review")}
					>
						スキャン結果
					</button>
					<button
						type="button"
						className={c.scanDetailTab === "report" ? "active" : ""}
						onClick={() => c.setScanDetailTab("report")}
					>
						レポート MD
					</button>
				</div>
			</div>
			{c.scanDetailTab === "report" ? (
				<ReportDetailPanel showHeader={false} />
			) : c.selectedScanRunId ? (
				<ScanResultsBody />
			) : (
				<EmptyFindingState />
			)}
			<FindingDetailDrawer />
		</section>
	);
}

function EmptyFindingState() {
	return (
		<div className="tree-info">
			左の一覧から scan run または finding
			を選択すると、スキャン内容と結果を確認できます。
		</div>
	);
}

function ScanResultsBody() {
	const c = useScans();
	return (
		<div className="scans-detail-scroll">
			{c.scanSummary ? <ScanResultOverview /> : <ScanSummaryPanel />}
			<div className="detail-section">
				<div className="scan-results-heading">
					<div>
						<h3 className="detail-section-title">検出された問題</h3>
						<p className="scan-tool-purpose">
							選択中の scan run で正規化された finding を table で確認します。
						</p>
					</div>
					<div className="finding-meta-row">
						<button
							type="button"
							className={`demo-button secondary ${c.findingsViewMode === "list" ? "active" : ""}`}
							onClick={() => {
								c.setFindingsViewMode("list");
								c.setSelectedGroupId("");
							}}
						>
							List ({c.findings.length})
						</button>
						<button
							type="button"
							className={`demo-button secondary ${c.findingsViewMode === "grouped" ? "active" : ""}`}
							onClick={() => c.setFindingsViewMode("grouped")}
						>
							Grouped ({c.scanGroups.length})
						</button>
					</div>
				</div>
				{c.findingsViewMode === "grouped" && c.scanGroups.length > 0 ? (
					<label htmlFor="findings-group-select" className="scan-table-filter">
						<span>Select Group</span>
						<SelectInput
							id="findings-group-select"
							value={c.selectedGroupId}
							onChange={(event) => c.setSelectedGroupId(event.target.value)}
						>
							<option value="">-- All Groups --</option>
							{c.scanGroups.map((group) => (
								<option key={group.id} value={group.id}>
									[{group.severity.toUpperCase()}] {group.title} (
									{group.findingIds.length})
								</option>
							))}
						</SelectInput>
					</label>
				) : null}
				<FindingsTable />
			</div>
		</div>
	);
}

function FindingsTable() {
	const c = useScans();
	if (c.displayedFindings.length === 0) {
		if (c.findingsLoading) {
			return <div className="tree-info">finding を読み込んでいます...</div>;
		}
		if (c.selectedScanRunId && c.findings.length === 0) {
			return <ZeroFindingDiagnosticPanel />;
		}
		return (
			<div className="tree-info">
				{c.findings.length === 0
					? "この scan run では finding は検出されていません。"
					: "選択中の group に一致する finding はありません。"}
			</div>
		);
	}
	return (
		<div className="scan-findings-table-wrap">
			<table className="scan-findings-table">
				<thead>
					<tr>
						<th>Severity</th>
						<th>Finding</th>
						<th>Tool / Rule</th>
						<th>Location</th>
						<th>Evidence</th>
						<th>Decision</th>
						<th>Updated</th>
					</tr>
				</thead>
				<tbody>
					{c.displayedFindings.map((finding) => {
						const location = finding.primaryLocation;
						const path =
							location && typeof location.path === "string"
								? location.path
								: "";
						const startLine =
							location &&
							(typeof location.startLine === "number" ||
								typeof location.startLine === "string")
								? String(location.startLine)
								: "";
						const decision = finding.latestDecision?.decision ?? "open";
						const workState =
							c.findingWorkStatesById.get(finding.id) ?? "ready_for_report";
						const evidenceQuality = c.evidenceQualityByFindingId.get(
							finding.id,
						);
						return (
							<tr
								key={finding.id}
								className={c.selectedFindingId === finding.id ? "active" : ""}
								onClick={() => c.handleSelectFinding(finding.id)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										c.handleSelectFinding(finding.id);
									}
								}}
								tabIndex={0}
							>
								<td>
									<span
										className={`severity-badge ${getSeverityClass(finding.severity)}`}
									>
										{finding.severity}
									</span>
								</td>
								<td>
									<strong>{finding.title}</strong>
									<small>{finding.description}</small>
								</td>
								<td>
									<span>{finding.sourceTool}</span>
									<code>{finding.ruleId}</code>
								</td>
								<td>
									{path ? (
										<code>
											{shortPath(path)}
											{startLine ? `:${startLine}` : ""}
										</code>
									) : (
										<span className="scan-table-muted">No location</span>
									)}
								</td>
								<td>
									<span
										className={`evidence-quality-badge evidence-${evidenceQuality?.level ?? "missing"}`}
									>
										{evidenceQuality?.label ?? "Missing"}
									</span>
								</td>
								<td>
									<div className="scan-table-badge-stack">
										<span className={`decision-badge badge-${decision}`}>
											{decision.replace("_", " ")}
										</span>
										<span className={`work-state-badge state-${workState}`}>
											{formatFindingWorkState(workState)}
										</span>
									</div>
								</td>
								<td>
									<small>{formatDateTime(finding.updatedAt)}</small>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function formatFindingWorkState(state: FindingWorkState): string {
	if (state === "false_positive_recorded") return "誤検知記録済み";
	if (state === "accepted_risk_recorded") return "リスク受容済み";
	if (state === "ready_for_report") return "レポート作成可能";
	return actionQueueStateLabel(state);
}

function FindingDetailDrawer() {
	const c = useScans();
	const panelRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!c.selectedFindingId) return;
		const handlePointerDown = (event: PointerEvent) => {
			const panel = panelRef.current;
			if (!panel || !(event.target instanceof Node)) return;
			if (!panel.contains(event.target)) c.handleCloseFinding();
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [c.selectedFindingId, c.handleCloseFinding]);
	if (!c.selectedFindingId) return null;
	const workflow = c.selectedDecisionWorkflow;
	const finding = c.selectedFindingDetails?.finding;
	const evidenceQuality = c.selectedEvidenceQuality;
	const workState = finding
		? (c.findingWorkStatesById.get(finding.id) ?? "ready_for_report")
		: null;
	return (
		<div className="scan-drawer-backdrop" role="presentation">
			<aside
				ref={panelRef}
				className="scan-drawer-panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="scan-finding-drawer-title"
			>
				<header className="scan-drawer-header">
					<div>
						<h2 id="scan-finding-drawer-title">Finding 詳細</h2>
						<p>検出内容、LLM レビュー、判断、検証結果を確認します。</p>
						{workflow ? (
							<div className="drawer-decision-summary">
								{finding ? (
									<span
										className={`severity-badge ${getSeverityClass(finding.severity)}`}
									>
										{finding.severity}
									</span>
								) : null}
								{workState ? (
									<span className={`work-state-badge state-${workState}`}>
										{formatFindingWorkState(workState)}
									</span>
								) : null}
								{evidenceQuality ? (
									<span
										className={`evidence-quality-badge evidence-${evidenceQuality.level}`}
									>
										証跡: {evidenceQuality.label}
									</span>
								) : null}
								<span
									className={`decision-workflow-state state-${workflow.decisionState}`}
								>
									{DECISION_STATE_LABELS[workflow.decisionState]}
								</span>
								<span
									className={`decision-badge badge-${workflow.latestDecision?.decision ?? "open"}`}
								>
									判断:{" "}
									{DECISION_LABELS[workflow.latestDecision?.decision ?? "open"]}
								</span>
								<span
									className={`decision-badge badge-${workflow.reportImpact.bucket}`}
								>
									レポート: {workflow.reportImpact.label}
								</span>
							</div>
						) : null}
					</div>
					<button
						type="button"
						className="scan-modal-close"
						onClick={c.handleCloseFinding}
						aria-label="finding 詳細を閉じる"
					>
						<X className="icon" />
					</button>
				</header>
				<div
					className="scan-detail-tabs scan-drawer-tabs"
					role="tablist"
					aria-label="finding 詳細ビュー"
				>
					<button
						type="button"
						className={c.scanDetailTab === "review" ? "active" : ""}
						onClick={() => c.setScanDetailTab("review")}
					>
						レビュー結果
					</button>
					<button
						type="button"
						className={c.scanDetailTab === "verification" ? "active" : ""}
						onClick={() => c.setScanDetailTab("verification")}
					>
						検証
					</button>
				</div>
				<div className="scan-drawer-body">
					{c.selectedFindingDetails ? (
						c.scanDetailTab === "verification" ? (
							<VerificationSections />
						) : (
							<FindingBody />
						)
					) : (
						<div className="tree-info">finding 詳細を読み込んでいます...</div>
					)}
				</div>
			</aside>
		</div>
	);
}

function FindingBody() {
	const c = useScans();
	const details = c.selectedFindingDetails;
	if (!details) return null;
	const finding = details.finding;
	return (
		<>
			<div className="detail-section">
				<div className="finding-meta-row">
					<span
						className={`severity-badge ${getSeverityClass(finding.severity)}`}
					>
						{finding.severity}
					</span>
					<strong>検査ツール: {finding.sourceTool}</strong>
					<code>ルール: {finding.ruleId}</code>
				</div>
				<h1>{finding.title}</h1>
				<p>{finding.description}</p>
			</div>
			<DecisionSection />
			<RemediationPlanSection />
			<DecisionCompletenessSummary />
			<EvidenceQualityPanel />
			<EvidenceChecklistPanel />
			<ReviewSection />
			<SourceEvidenceDetail />
			<ReportImpactPreview />
		</>
	);
}

function DecisionCompletenessSummary() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="decision-summary-panel">
			<div>
				<span className="scan-review-context-label">判断状態</span>
				<strong>{DECISION_STATE_LABELS[workflow.decisionState]}</strong>
			</div>
			<div>
				<span className="scan-review-context-label">
					トリアージ前に不足している情報
				</span>
				<strong>
					{workflow.missingInputs.length > 0
						? workflow.missingInputs.join(", ")
						: "なし"}
				</strong>
			</div>
			{workflow.recommendedReason ? (
				<div>
					<span className="scan-review-context-label">推奨される理由</span>
					<strong>{REASON_LABELS[workflow.recommendedReason]}</strong>
				</div>
			) : null}
		</div>
	);
}

function EvidenceQualityPanel() {
	const quality = useScans().selectedEvidenceQuality;
	if (!quality) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">Evidence quality</h3>
			<div className="evidence-quality-panel">
				<div className="evidence-quality-score">
					<span className={`evidence-quality-badge evidence-${quality.level}`}>
						{quality.label}
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

function EvidenceChecklistPanel() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">判断材料チェックリスト</h3>
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

function SourceEvidenceDetail() {
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
									{item.title || `Artifact ${item.artifactId?.slice(0, 8)}`}
								</a>
							))}
					</div>
				</div>
			) : null}
		</>
	);
}

function ReportImpactPreview() {
	const workflow = useScans().selectedDecisionWorkflow;
	if (!workflow) return null;
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<FileText className="icon" /> レポートへの反映
			</h3>
			<div className="report-impact-panel">
				<div>
					<span className="scan-review-context-label">分類</span>
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
					<span className="scan-review-context-label">人間の判断</span>
					<strong>
						{workflow.latestDecision
							? REASON_LABELS[workflow.latestDecision.reason]
							: "判断はまだ記録されていません"}
					</strong>
				</div>
			</div>
		</div>
	);
}
