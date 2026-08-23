import { Copy, Download } from "lucide-react";
import { useState } from "react";
import { MarkdownRenderer } from "../../../components/markdown-renderer";
import { Button } from "../../../ui";
import {
	buildScanImprovementRequestMarkdown,
	type ScanImprovementRequestView,
} from "./scan-improvement-request";

type ScanImprovementRequestPanelProps = {
	view: ScanImprovementRequestView;
};

export function ScanImprovementRequestPanel({
	view,
}: ScanImprovementRequestPanelProps) {
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
		"idle",
	);
	const request = view.request;
	if (!view.available || !request) return null;
	const markdown = buildScanImprovementRequestMarkdown(request);
	const copyHandoffPrompt = async () => {
		if (typeof navigator === "undefined" || !navigator.clipboard) {
			setCopyStatus("failed");
			return;
		}
		try {
			await navigator.clipboard.writeText(markdown);
			setCopyStatus("copied");
		} catch {
			setCopyStatus("failed");
		}
	};
	const exportMarkdown = () => {
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
			<div className="scan-handoff-actions">
				<Button
					type="button"
					variant="secondary"
					onClick={() => void copyHandoffPrompt()}
				>
					<Copy className="icon" />
					{copyStatus === "copied" ? "コピーしました" : "指示書をコピー"}
				</Button>
				<Button type="button" variant="secondary" onClick={exportMarkdown}>
					<Download className="icon" />
					Markdown 出力
				</Button>
			</div>
			{copyStatus === "failed" ? (
				<p className="workspace-inline-error" role="status">
					クリップボードへコピーできませんでした。
				</p>
			) : null}
			<MarkdownRenderer
				markdown={markdown}
				ariaLabel="改修依頼指示書"
				className="scan-handoff-markdown"
			/>
		</section>
	);
}
