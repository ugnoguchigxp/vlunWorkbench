import { Download, RefreshCw } from "lucide-react";
import { MarkdownEditor } from "markdown-wysiwyg-editor";
import mermaid from "mermaid";
import { Button } from "../../../ui";
import { formatScanOutcome } from "../scan-profile-display";
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
								? `レポート: ${c.selectedReport.title}`
								: "scan レポート"}
						</h2>
						<Button
							type="button"
							variant="secondary"
							onClick={() => c.setViewingReport(false)}
						>
							finding に戻る
						</Button>
					</div>
				</div>
			) : null}
			<div className="scans-detail-scroll">
				<ReportReadinessPreview />
				{c.selectedReport ? (
					<ReportBody />
				) : (
					<div className="tree-info">レポートが選択されていません。</div>
				)}
			</div>
		</>
	);
}

function ReportReadinessPreview() {
	const c = useScans();
	const preview = c.reportQualityPreview;
	return (
		<div
			className={`decision-grade-panel report-readiness readiness-${preview.readiness}`}
		>
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">レポート準備状況</span>
					<h3>{formatReportReadiness(preview.readiness)}</h3>
					<small>{preview.secondaryStatusLabel}</small>
				</div>
				<small>{preview.recommendedReportTitle}</small>
			</div>
			<div className="report-readiness-sections">
				{preview.sections.map((section) => (
					<div
						key={section.id}
						className={`report-section-status status-${section.status}`}
					>
						<strong>{section.label}</strong>
						<small>{section.reason ?? section.status}</small>
					</div>
				))}
			</div>
		</div>
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
					状態: {formatScanOutcome(report.status)}
				</span>
				<small>作成: {formatDateTime(report.createdAt)}</small>
				{report.status === "completed" ? (
					<a href={`/api/scan-reports/${report.id}/download`} download>
						<Download size={14} /> レポートをダウンロード
					</a>
				) : null}
			</div>
			{report.status === "running" ? (
				<div className="tree-info">
					<RefreshCw className="icon animate-spin" /> レポートを生成中...
				</div>
			) : null}
			{report.status === "failed" ? (
				<div className="assessment-card">
					<strong>生成に失敗</strong>
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
				<div className="tree-info">レポート preview を読み込んでいます...</div>
			) : null}
		</div>
	);
}

function formatReportReadiness(readiness: string): string {
	if (readiness === "ready") return "準備完了";
	if (readiness === "partial") return "一部準備済み";
	return "未完了";
}
