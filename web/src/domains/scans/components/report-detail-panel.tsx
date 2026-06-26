import { Download, RefreshCw } from "lucide-react";
import { MarkdownEditor } from "markdown-wysiwyg-editor";
import mermaid from "mermaid";
import { Button } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";

export function ReportDetailPanel({
	showHeader = true,
}: {
	showHeader?: boolean;
}) {
	const c = useScans();
	return (
		<>
			{showHeader ? (
				<div className="scans-panel-header">
					<div className="finding-meta-row">
						<h2>
							{c.selectedReport
								? `Report: ${c.selectedReport.title}`
								: "Scan Report"}
						</h2>
						<Button
							type="button"
							variant="secondary"
							onClick={() => c.setViewingReport(false)}
						>
							Back to Findings
						</Button>
					</div>
				</div>
			) : null}
			<div className="scans-detail-scroll">
				{c.selectedReport ? (
					<ReportBody />
				) : (
					<div className="tree-info">No report selected.</div>
				)}
			</div>
		</>
	);
}

function ReportBody() {
	const c = useScans();
	const report = c.selectedReport;
	if (!report) return null;
	return (
		<div className="detail-section">
			<div className="finding-meta-row">
				<span className={`scan-status-badge badge-${report.status}`}>
					Status: {report.status}
				</span>
				<small>Created: {formatDateTime(report.createdAt)}</small>
				{report.status === "completed" ? (
					<a href={`/api/scan-reports/${report.id}/download`} download>
						<Download size={14} /> Download Report
					</a>
				) : null}
			</div>
			{report.status === "running" ? (
				<div className="tree-info">
					<RefreshCw className="icon animate-spin" /> Generating report...
				</div>
			) : null}
			{report.status === "failed" ? (
				<div className="assessment-card">
					<strong>Generation Failed</strong>
					<p>{report.errorMessage}</p>
				</div>
			) : null}
			{report.status === "completed" && c.reportPreviewContent ? (
				<div className="artifact-renderer">
					<MarkdownEditor
						value={c.reportPreviewContent}
						editable={false}
						enableMermaid
						mermaidLib={mermaid}
						toolbarMode="hidden"
						autoHeight
						className="wysiwyg-viewer"
					/>
				</div>
			) : report.status === "completed" ? (
				<div className="tree-info">Loading report preview...</div>
			) : null}
		</div>
	);
}
