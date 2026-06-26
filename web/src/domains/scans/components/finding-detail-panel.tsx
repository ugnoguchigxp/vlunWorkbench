import { Download } from "lucide-react";
import { useScans } from "../scans-context";
import { getSeverityClass, shortPath } from "../scans-utils";
import { DecisionSection } from "./decision-section";
import { ReportDetailPanel } from "./report-detail-panel";
import { ReviewSection } from "./review-section";
import { ScanSummaryPanel } from "./scan-summary-panel";
import { VerificationSections } from "./verification-sections";

export function FindingDetailPanel() {
	const c = useScans();
	return (
		<section className="scans-panel scans-detail-col">
			<div className="scans-panel-header scan-detail-header">
				<div>
					<h2>Finding Analysis & LLM Review</h2>
					{c.selectedScanRunId ? (
						<small>
							{c.displayedFindings.length} findings / {c.reports.length} reports
						</small>
					) : null}
				</div>
				<div
					className="scan-detail-tabs"
					role="tablist"
					aria-label="Scan result views"
				>
					<button
						type="button"
						className={c.scanDetailTab === "review" ? "active" : ""}
						onClick={() => c.setScanDetailTab("review")}
					>
						Review Results
					</button>
					<button
						type="button"
						className={c.scanDetailTab === "verification" ? "active" : ""}
						onClick={() => c.setScanDetailTab("verification")}
					>
						Verification
					</button>
					<button
						type="button"
						className={c.scanDetailTab === "report" ? "active" : ""}
						onClick={() => c.setScanDetailTab("report")}
					>
						Report MD
					</button>
				</div>
			</div>
			{c.scanDetailTab === "report" ? (
				<ReportDetailPanel showHeader={false} />
			) : c.scanDetailTab === "verification" ? (
				c.selectedFindingDetails ? (
					<div className="scans-detail-scroll">
						<VerificationSections />
					</div>
				) : (
					<EmptyFindingState />
				)
			) : c.selectedFindingDetails ? (
				<FindingBody />
			) : c.scanSummary ? (
				<ScanSummaryPanel />
			) : (
				<EmptyFindingState />
			)}
		</section>
	);
}

function EmptyFindingState() {
	return (
		<div className="tree-info">
			Select a finding from the list to view its details and trigger
			assessments.
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
		<div className="scans-detail-scroll">
			<div className="detail-section">
				<div className="finding-meta-row">
					<span
						className={`severity-badge ${getSeverityClass(finding.severity)}`}
					>
						{finding.severity}
					</span>
					<strong>Tool: {finding.sourceTool}</strong>
					<code>Rule: {finding.ruleId}</code>
				</div>
				<h1>{finding.title}</h1>
				<p>{finding.description}</p>
			</div>
			{location ? (
				<div className="detail-section">
					<h3 className="detail-section-title">Primary Location</h3>
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
					<h3 className="detail-section-title">
						Primary Scan Evidence Artifacts
					</h3>
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
		</div>
	);
}
