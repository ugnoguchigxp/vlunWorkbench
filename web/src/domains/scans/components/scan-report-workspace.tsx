import { ChevronDown, FileText, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ScanReport, ScanReview } from "../../../api";
import { renderMarkdownToSafeHtml } from "../../../components/safe-markdown";
import { Button, SelectInput } from "../../../ui";
import { llmCommentTitle } from "../report-workspace-view-model";
import { useReportWorkspaceController } from "../use-report-workspace-controller";

type ReportDisplayMode = "rendered" | "source";

export function ScanReportWorkspace({
	reports,
	scanReviews,
	requestedReportId,
	generating,
	onSelectReport,
	onGenerate,
}: {
	reports: ScanReport[];
	scanReviews: ScanReview[];
	requestedReportId?: string;
	generating: boolean;
	onSelectReport: (reportId: string) => void;
	onGenerate: () => void;
}) {
	const viewer = useReportWorkspaceController({
		reports,
		scanReviews,
		requestedReportId,
	});
	const [displayMode, setDisplayMode] = useState<ReportDisplayMode>("rendered");
	const [llmExpanded, setLlmExpanded] = useState(false);
	const html = useMemo(
		() => renderMarkdownToSafeHtml(viewer.markdown),
		[viewer.markdown],
	);

	useEffect(() => {
		setLlmExpanded(viewer.llmCommentForcedOpen);
	}, [viewer.llmCommentForcedOpen]);

	if (!reports.length) {
		return (
			<section
				className="workspace-tab-panel workspace-report-empty"
				role="tabpanel"
			>
				<FileText aria-hidden="true" />
				<h2>Markdownレポート</h2>
				<p>
					完了したスキャンから、共有できるセキュリティ診断レポートを作成します。
				</p>
				<Button
					type="button"
					variant="primary"
					onClick={onGenerate}
					disabled={generating}
				>
					{generating ? "生成中..." : "レポートを生成"}
				</Button>
			</section>
		);
	}

	return (
		<section
			className="workspace-tab-panel workspace-report-panel"
			role="tabpanel"
		>
			<div className="workspace-report-toolbar">
				<div>
					<p className="workspace-eyebrow">Security report</p>
					<h2>Markdownレポート</h2>
				</div>
				<label htmlFor="scan-report-select">
					<span className="visually-hidden">表示するレポート</span>
					<SelectInput
						id="scan-report-select"
						value={viewer.reportId ?? ""}
						onChange={(event) => onSelectReport(event.target.value)}
					>
						{reports.map((item) => (
							<option key={item.id} value={item.id}>
								{item.title}（{reportStatusLabel(item.status)}）
							</option>
						))}
					</SelectInput>
				</label>
			</div>
			{viewer.status === "loading" ? (
				<p className="workspace-report-state">レポートを読み込んでいます...</p>
			) : null}
			{viewer.status === "failed" ? (
				<p className="workspace-inline-error">
					{viewer.error ?? "レポートを読み込めませんでした。"}
				</p>
			) : null}
			{viewer.status === "ready" && viewer.report ? (
				<>
					<ReportMetadata report={viewer.report} />
					{viewer.llmCommentAvailable ? (
						<LlmCommentAccordion
							review={viewer.review}
							expanded={llmExpanded}
							forcedOpen={viewer.llmCommentForcedOpen}
							acknowledging={viewer.acknowledging}
							acknowledgementError={viewer.acknowledgementError}
							onToggle={() => setLlmExpanded((value) => !value)}
							onAcknowledge={() => void viewer.acknowledgeLlmComment()}
						/>
					) : null}
					<fieldset className="workspace-report-mode-toggle">
						<legend className="visually-hidden">レポートの表示形式</legend>
						<Button
							type="button"
							variant={displayMode === "rendered" ? "secondary" : "ghost"}
							onClick={() => setDisplayMode("rendered")}
						>
							プレビュー
						</Button>
						<Button
							type="button"
							variant={displayMode === "source" ? "secondary" : "ghost"}
							onClick={() => setDisplayMode("source")}
						>
							Markdown
						</Button>
					</fieldset>
					{viewer.report.status !== "completed" ? (
						<p className="workspace-report-state">
							このレポートは{reportStatusLabel(viewer.report.status)}
							です。生成完了後に内容を表示します。
						</p>
					) : displayMode === "rendered" ? (
						<article
							className="workspace-markdown"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: raw HTML, images and unsafe links are removed by renderMarkdownToSafeHtml.
							dangerouslySetInnerHTML={{ __html: html }}
						/>
					) : (
						<pre className="workspace-markdown-source">
							<code>{viewer.markdown}</code>
						</pre>
					)}
				</>
			) : null}
		</section>
	);
}

function ReportMetadata({ report }: { report: ScanReport }) {
	return (
		<div className="workspace-report-metadata">
			<div>
				<span>状態</span>
				<strong>{reportStatusLabel(report.status)}</strong>
			</div>
			<div>
				<span>生成日時</span>
				<strong>{formatDateTime(report.createdAt)}</strong>
			</div>
			<div>
				<span>形式</span>
				<strong>{report.format?.toUpperCase() || "MARKDOWN"}</strong>
			</div>
		</div>
	);
}

function LlmCommentAccordion({
	review,
	expanded,
	forcedOpen,
	acknowledging,
	acknowledgementError,
	onToggle,
	onAcknowledge,
}: {
	review: ScanReview | null;
	expanded: boolean;
	forcedOpen: boolean;
	acknowledging: boolean;
	acknowledgementError: string | null;
	onToggle: () => void;
	onAcknowledge: () => void;
}) {
	if (!review) return null;
	return (
		<section
			className={
				forcedOpen ? "workspace-llm-comment forced" : "workspace-llm-comment"
			}
		>
			<button
				type="button"
				className="workspace-llm-comment-heading"
				aria-expanded={expanded}
				disabled={forcedOpen}
				onClick={onToggle}
			>
				<span>
					<Sparkles aria-hidden="true" /> LLMコメント{" "}
					{forcedOpen ? "（確認が必要）" : ""}
				</span>
				<ChevronDown aria-hidden="true" />
			</button>
			{expanded ? (
				<div className="workspace-llm-comment-body">
					<p>{llmCommentTitle(review)}</p>
					{review.priorityNotes.length ? (
						<CommentList title="優先事項" items={review.priorityNotes} />
					) : null}
					{review.recommendedNextActions.length ? (
						<CommentList
							title="次のアクション"
							items={review.recommendedNextActions.slice(0, 2)}
						/>
					) : null}
					{forcedOpen ? (
						<Button
							type="button"
							variant="secondary"
							onClick={onAcknowledge}
							disabled={acknowledging}
						>
							{acknowledging ? "保存中..." : "コメントを確認した"}
						</Button>
					) : null}
					{acknowledgementError ? (
						<p className="workspace-dialog-error" role="alert">
							{acknowledgementError}
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}

function CommentList({ title, items }: { title: string; items: string[] }) {
	return (
		<div className="workspace-llm-comment-list">
			<h3>{title}</h3>
			<ul>
				{items.map((item) => (
					<li key={item}>{item}</li>
				))}
			</ul>
		</div>
	);
}

const reportStatusLabel = (status: ScanReport["status"]): string =>
	({
		queued: "待機中",
		running: "生成中",
		completed: "完了",
		failed: "失敗",
	})[status];

const formatDateTime = (value: string): string =>
	new Date(value).toLocaleString("ja-JP", {
		dateStyle: "medium",
		timeStyle: "short",
	});
