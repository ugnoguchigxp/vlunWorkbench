import {
	CheckCircle2,
	Code,
	Copy,
	Download,
	MinusCircle,
	XCircle,
} from "lucide-react";
import { Button } from "../../../ui";
import {
	buildScanImprovementRequestMarkdown,
	type ScanImprovementRequestView,
} from "../scan-improvement-request";
import { formatDateTime } from "../scans-utils";

type ScanImprovementRequestPanelProps = {
	view: ScanImprovementRequestView;
	completedAt?: string | null;
	providerLabel?: string | null;
	compact?: boolean;
};

export function ScanImprovementRequestPanel({
	view,
	completedAt,
	providerLabel,
	compact = false,
}: ScanImprovementRequestPanelProps) {
	const request = view.request;
	if (!view.available || !request) return null;
	const copyHandoffPrompt = () => {
		if (typeof navigator === "undefined" || !navigator.clipboard) return;
		void navigator.clipboard.writeText(view.handoffPrompt);
	};
	const exportMarkdown = () => {
		const markdown = buildScanImprovementRequestMarkdown(request);
		const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${view.title || "scan-handoff"}.md`;
		anchor.click();
		URL.revokeObjectURL(url);
	};
	return (
		<section className="decision-grade-panel scan-improvement-request">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">LLM 引き継ぎ</span>
					<h3>
						<Code className="icon" />
						{view.title}
					</h3>
					{providerLabel || completedAt ? (
						<small>
							{providerLabel}
							{providerLabel && completedAt ? " / " : ""}
							{completedAt ? formatDateTime(completedAt) : ""}
						</small>
					) : null}
				</div>
				<div className="scan-handoff-actions">
					<Button type="button" variant="secondary" onClick={copyHandoffPrompt}>
						<Copy className="icon" />
						コピー
					</Button>
					<Button type="button" variant="secondary" onClick={exportMarkdown}>
						<Download className="icon" />
						Markdown 出力
					</Button>
				</div>
			</div>
			<p>{view.objective}</p>
			<div className="scan-handoff-quality">
				{view.qualityChecks.map((check) => (
					<div
						className={`scan-handoff-quality-item status-${check.status}`}
						key={check.id}
					>
						{check.status === "ready" ? (
							<CheckCircle2 className="icon" />
						) : check.status === "partial" ? (
							<MinusCircle className="icon" />
						) : (
							<XCircle className="icon" />
						)}
						<span>
							<strong>{check.label}</strong>
							<small>{check.reason}</small>
						</span>
					</div>
				))}
			</div>
			{request.implementationTasks.length > 0 ? (
				<div className="decision-grade-list compact">
					{request.implementationTasks.slice(0, compact ? 3 : 6).map((task) => (
						<div
							className="decision-grade-command"
							key={`${task.title}-${task.findingIds.join("-")}`}
						>
							<span>
								<strong>{task.title}</strong>
								<small>{task.body}</small>
							</span>
							{task.findingIds.length > 0 ? (
								<small>{task.findingIds.join(", ")}</small>
							) : null}
						</div>
					))}
				</div>
			) : null}
			<pre className="remediation-box">
				<code>{view.handoffPrompt}</code>
			</pre>
		</section>
	);
}
