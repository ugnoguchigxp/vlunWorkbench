import { ArrowRight, CheckCircle2, Circle, OctagonAlert } from "lucide-react";
import { useScans } from "../scans-context";

const stageLabels = {
	scan_running: "Scan running",
	needs_review: "Needs review",
	needs_handoff: "Needs implementation handoff",
	needs_verification: "Needs verification",
	needs_remediation_plan: "Needs remediation plan",
	report_ready: "Report ready",
	report_generated: "Report generated",
} as const;

export function WorkflowCompletionPanel() {
	const c = useScans();
	const completion = c.workflowCompletion;
	return (
		<section className="decision-grade-panel workflow-panel">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">Workflow completion</span>
					<h3>{stageLabels[completion.stage]}</h3>
				</div>
				<strong>{completion.percent}%</strong>
			</div>
			<div
				className="workflow-progress"
				role="progressbar"
				aria-label="workflow progress"
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
							<small>{item.count ?? item.blockingReason ?? ""}</small>
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
