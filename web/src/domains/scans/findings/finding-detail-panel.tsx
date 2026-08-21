import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { MarkdownEditor } from "../../../components/markdown-editor";
import { DecisionSection } from "../components/decision-section";
import { RemediationPlanSection } from "../components/remediation-plan-section";
import { ReviewSection } from "../components/review-section";
import { ScanResultOverview } from "../components/scan-result-overview";
import { ScanSummaryPanel } from "../components/scan-summary-panel";
import { VerificationSections } from "../components/verification-sections";
import { ZeroFindingDiagnosticPanel } from "../components/zero-finding-diagnostic-panel";
import { readDiffFindingRelationDisplay } from "../diff-target-display";
import { ReportDetailPanel } from "../reporting/report-detail-panel";
import { formatFindingTitle, formatSeverityLabel } from "../scan-display-copy";
import { useScans } from "../scans-context";
import { formatDateTime, getSeverityClass, shortPath } from "../scans-utils";
import { actionQueueStateLabel, type FindingWorkState } from "../work-states";
import {
	DECISION_LABELS,
	DECISION_STATE_LABELS,
} from "./finding-detail-labels";
import {
	DecisionCompletenessSummary,
	EvidenceChecklistPanel,
	EvidenceQualityPanel,
	ReportImpactPreview,
	SourceEvidenceDetail,
} from "./finding-evidence-panels";

export function FindingDetailPanel({ onClose }: { onClose: () => void }) {
	const c = useScans();
	return (
		<section className="scans-panel scans-detail-col">
			<div className="scans-panel-header scan-detail-header">
				<div className="scan-detail-heading-copy">
					<h2>finding 分析</h2>
					<p>
						選択中のスキャンが何を確認したものか、その結果として出た
						finding、保存済みレビュー、検証、レポートを確認します。
					</p>
					{c.selectedScanRunId ? (
						<small>
							finding {c.displayedFindings.length} 件 / レポート{" "}
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
						role="tab"
						className={c.scanDetailTab === "review" ? "active" : ""}
						aria-selected={c.scanDetailTab === "review"}
						onClick={() => c.setScanDetailTab("review")}
					>
						スキャン結果
					</button>
					<button
						type="button"
						role="tab"
						className={c.scanDetailTab === "report" ? "active" : ""}
						aria-selected={c.scanDetailTab === "report"}
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
			<FindingDetailDrawer onClose={onClose} />
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
							既定では重複を統合した issue を表示します。raw finding と証跡はいつでも確認できます。
						</p>
					</div>
					<div className="finding-meta-row">
						<button
							type="button"
							className={`demo-button secondary ${c.findingsViewMode === "grouped" ? "active" : ""}`}
							onClick={() => {
								c.setFindingsViewMode("grouped");
								c.setSelectedGroupId("");
							}}
						>
							Issue ({c.scanGroups.length})
						</button>
						<button
							type="button"
							className={`demo-button secondary ${c.findingsViewMode === "list" ? "active" : ""}`}
							onClick={() => c.setFindingsViewMode("list")}
						>
							Raw finding ({c.scanSummary?.totals.findingCount ?? c.findings.length})
						</button>
					</div>
				</div>
				<FindingsTable />
			</div>
		</div>
	);
}

function FindingsTable() {
	const c = useScans();
	if (c.findingsViewMode === "grouped") return <IssueGroupsTable />;
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
						<th>重大度</th>
						<th>finding</th>
						<th>tool / rule</th>
						<th>位置</th>
						<th>証跡</th>
						<th>自動化</th>
						<th>更新</th>
					</tr>
				</thead>
				<tbody>
					{c.displayedFindings.map((finding) => {
						const diffRelation = readDiffFindingRelationDisplay(
							finding.metadata,
						);
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
										{formatSeverityLabel(finding.severity)}
									</span>
								</td>
								<td>
									<strong>{formatFindingTitle(finding.title)}</strong>
									<small>{finding.description}</small>
									{diffRelation ? (
										<small
											className={`diff-relation-badge relation-${diffRelation.kind}`}
										>
											{diffRelation.label}
										</small>
									) : null}
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
										<span className="scan-table-muted">位置なし</span>
									)}
								</td>
								<td>
									<span
										className={`evidence-quality-badge evidence-${evidenceQuality?.level ?? "missing"}`}
									>
										{evidenceQuality?.label ?? "不足"}
									</span>
									{evidenceQuality ? (
										<small className="scan-table-muted">
											{evidenceQuality.dataCompletenessLabel}
										</small>
									) : null}
								</td>
								<td>
									<div className="scan-table-badge-stack">
										<span className={`decision-badge badge-${decision}`}>
											{DECISION_LABELS[
												decision as keyof typeof DECISION_LABELS
											] ?? decision.replace("_", " ")}
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

function IssueGroupsTable() {
	const c = useScans();
	if (c.scanGroups.length === 0) {
		if (c.findingsLoading) {
			return <div className="tree-info">issue を読み込んでいます...</div>;
		}
		if (c.selectedScanRunId && c.findings.length === 0) {
			return <ZeroFindingDiagnosticPanel />;
		}
		return (
			<div className="tree-info">
				issue grouping を取得できませんでした。Raw finding 表示で確認してください。
			</div>
		);
	}
	const rawCount = c.scanSummary?.totals.findingCount ?? c.findings.length;
	return (
		<>
			<p className="scan-tool-purpose">
				{c.scanGroups.length} issues / {rawCount} raw findings /{" "}
				{Math.max(0, rawCount - c.scanGroups.length)} duplicates grouped
			</p>
			<div className="scan-findings-table-wrap">
				<table className="scan-findings-table">
					<thead>
						<tr>
							<th>重大度</th>
							<th>issue</th>
							<th>scanner signals</th>
							<th>位置</th>
							<th>統合根拠</th>
						</tr>
					</thead>
					<tbody>
						{c.scanGroups.map((group) => {
							const location = group.primaryLocation;
							const path = typeof location.path === "string" ? location.path : "";
							const line =
								typeof location.startLine === "string" ||
								typeof location.startLine === "number"
									? String(location.startLine)
									: "";
							return (
								<tr
									key={group.id}
									className={
										c.selectedFindingId === group.representativeFindingId
											? "active"
											: ""
									}
									onClick={() => {
										c.setSelectedGroupId(group.id);
										c.handleSelectFinding(group.representativeFindingId);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											c.setSelectedGroupId(group.id);
											c.handleSelectFinding(group.representativeFindingId);
										}
									}}
									tabIndex={0}
								>
									<td>
										<span className={`severity-badge ${getSeverityClass(group.severity)}`}>
											{formatSeverityLabel(group.severity)}
										</span>
									</td>
									<td>
										<strong>{formatFindingTitle(group.title)}</strong>
										<small>{group.description}</small>
										<details>
											<summary>{group.findingIds.length} raw findings</summary>
											<div className="finding-meta-row">
												{group.findingIds.map((findingId) => (
													<button
														type="button"
														className="demo-button secondary"
														key={findingId}
														onClick={(event) => {
															event.stopPropagation();
															c.handleSelectFinding(findingId);
														}}
													>
														{findingId}
													</button>
												))}
											</div>
										</details>
									</td>
									<td>{group.sourceTools.join(", ")}</td>
									<td>
										{path ? <code>{shortPath(path)}{line ? `:${line}` : ""}</code> : "位置なし"}
									</td>
									<td>
										{group.reasonCodes.join(", ") || "singleton"}
										<small>{group.matchConfidence}</small>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
}

function formatFindingWorkState(state: FindingWorkState): string {
	if (state === "false_positive_recorded") return "誤検知記録済み";
	if (state === "accepted_risk_recorded") return "リスク受容済み";
	if (state === "ready_for_report") return "レポート作成可能";
	return actionQueueStateLabel(state);
}

function FindingDetailDrawer({ onClose }: { onClose: () => void }) {
	const c = useScans();
	const panelRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!c.selectedFindingId) return;
		const handlePointerDown = (event: PointerEvent) => {
			const panel = panelRef.current;
			if (!panel || !(event.target instanceof Node)) return;
			if (!panel.contains(event.target)) onClose();
		};
		document.addEventListener("pointerdown", handlePointerDown);
		return () => document.removeEventListener("pointerdown", handlePointerDown);
	}, [c.selectedFindingId, onClose]);
	if (!c.selectedFindingId) return null;
	const workflow = c.selectedDecisionWorkflow;
	const finding = c.selectedFindingDetails?.finding;
	const evidenceQuality = c.selectedEvidenceQuality;
	const diffRelation = finding
		? readDiffFindingRelationDisplay(finding.metadata)
		: null;
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
						<h2 id="scan-finding-drawer-title">finding 詳細</h2>
						<p>
							検出内容、保存済み証跡、LLM レビュー、検証結果、handoff を使って、
							次の LLM に渡す実装改善リスクを確認します。
						</p>
						{workflow ? (
							<div className="drawer-decision-summary">
								{finding ? (
									<span
										className={`severity-badge ${getSeverityClass(finding.severity)}`}
									>
										{formatSeverityLabel(finding.severity)}
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
								{diffRelation ? (
									<span
										className={`diff-relation-badge relation-${diffRelation.kind}`}
									>
										{diffRelation.label}
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
									互換:{" "}
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
						onClick={onClose}
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
						role="tab"
						className={c.scanDetailTab === "review" ? "active" : ""}
						aria-selected={c.scanDetailTab === "review"}
						onClick={() => c.setScanDetailTab("review")}
					>
						レビュー結果
					</button>
					<button
						type="button"
						role="tab"
						className={c.scanDetailTab === "verification" ? "active" : ""}
						aria-selected={c.scanDetailTab === "verification"}
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
						{formatSeverityLabel(finding.severity)}
					</span>
					<strong>検査ツール: {finding.sourceTool}</strong>
					<code>ルール: {finding.ruleId}</code>
				</div>
				<h1>{formatFindingTitle(finding.title)}</h1>
				<FindingDescriptionMarkdown value={finding.description} />
			</div>
			<RemediationPlanSection />
			<DecisionCompletenessSummary />
			<EvidenceQualityPanel />
			<EvidenceChecklistPanel />
			<ReviewSection />
			<DecisionSection />
			<SourceEvidenceDetail />
			<ReportImpactPreview />
		</>
	);
}

export function FindingDescriptionMarkdown({ value }: { value: string }) {
	return (
		<MarkdownEditor
			value={value}
			editable={false}
			autoHeight={true}
			className="finding-description-markdown"
		/>
	);
}
