import { ArrowRight, CheckCircle2, Circle, OctagonAlert } from "lucide-react";
import { useScans } from "../scans-context";

const stageLabels = {
	scan_running: "スキャン実行中",
	scan_failed: "スキャン失敗",
	scan_blocked: "スキャンはブロックされています",
	scan_incomplete: "スキャンは未完了です",
	diagnostic_running: "自動診断実行中",
	diagnostic_retry: "自動診断の再実行が必要",
	needs_review: "LLM レビューが必要",
	needs_handoff: "LLM handoff が必要",
	needs_verification: "検証が必要",
	needs_remediation_plan: "修正計画が必要",
	report_ready: "レポート生成可能",
	report_generated: "レポート生成済み",
} as const;

export function WorkflowCompletionPanel() {
	const c = useScans();
	const completion = c.workflowCompletion;
	return (
		<section className="decision-grade-panel workflow-panel">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">ワークフロー完了</span>
					<h3>{stageLabels[completion.stage]}</h3>
				</div>
				<strong>{completion.percent}%</strong>
			</div>
			<div
				className="workflow-progress"
				role="progressbar"
				aria-label="ワークフロー進捗"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={completion.percent}
			>
				<span style={{ width: `${completion.percent}%` }} />
			</div>
			<div className="workflow-checklist">
				{completion.checklist.map((item) => (
					<div key={item.id} className={`workflow-check status-${item.status}`}>
						{item.status === "complete" ? (
							<CheckCircle2 className="icon" />
						) : item.status === "blocked" ? (
							<OctagonAlert className="icon" />
						) : (
							<Circle className="icon" />
						)}
						<span>
							<strong>{item.label}</strong>
							<small>{item.explanation}</small>
							{item.count || item.blockingReason ? (
								<small>{item.count ?? item.blockingReason}</small>
							) : null}
						</span>
					</div>
				))}
			</div>
			{completion.nextBestAction ? (
				<button
					type="button"
					className="decision-grade-command"
					onClick={c.handleWorkflowNextAction}
				>
					{completion.nextBestAction.label}
					<ArrowRight className="icon" />
				</button>
			) : null}
		</section>
	);
}
