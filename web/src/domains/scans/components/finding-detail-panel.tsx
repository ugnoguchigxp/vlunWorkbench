import { Download, X } from "lucide-react";
import { SelectInput } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime, getSeverityClass, shortPath } from "../scans-utils";
import { DecisionSection } from "./decision-section";
import { ReportDetailPanel } from "./report-detail-panel";
import { ReviewSection } from "./review-section";
import { ScanResultOverview } from "./scan-result-overview";
import { ScanSummaryPanel } from "./scan-summary-panel";
import { VerificationSections } from "./verification-sections";

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
									<span className={`decision-badge badge-${decision}`}>
										{decision.replace("_", " ")}
									</span>
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

function FindingDetailDrawer() {
	const c = useScans();
	if (!c.selectedFindingId) return null;
	return (
		<div className="scan-drawer-backdrop" role="presentation">
			<aside
				className="scan-drawer-panel"
				role="dialog"
				aria-modal="true"
				aria-labelledby="scan-finding-drawer-title"
			>
				<header className="scan-drawer-header">
					<div>
						<h2 id="scan-finding-drawer-title">Finding Detail</h2>
						<p>検出内容、LLM レビュー、判断、検証結果を確認します。</p>
					</div>
					<button
						type="button"
						className="scan-modal-close"
						onClick={c.handleCloseFinding}
						aria-label="Close finding detail"
					>
						<X className="icon" />
					</button>
				</header>
				<div
					className="scan-detail-tabs scan-drawer-tabs"
					role="tablist"
					aria-label="Finding detail views"
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
						<div className="tree-info">Loading finding detail...</div>
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
	const location = finding.primaryLocation;
	const sourceSnippet =
		details.evidence.find(
			(item) => item.kind === "source-location" && item.snippet,
		)?.snippet ||
		(typeof finding.metadata?.snippet === "string"
			? finding.metadata.snippet
			: "") ||
		"// Snippet not available";
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
			{location ? (
				<div className="detail-section">
					<h3 className="detail-section-title">主な検出位置</h3>
					<div className="code-snippet-box">
						<div className="code-snippet-header">
							<div className="code-snippet-title">
								{shortPath(location.path)}
								{location.startLine ? `#L${location.startLine}` : ""}
							</div>
						</div>
						<pre className="code-snippet-body">
							<code>{sourceSnippet}</code>
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
			<ReviewSection />
			<DecisionSection />
		</>
	);
}
