import { Save } from "lucide-react";
import { Button } from "../../../ui";
import { useScans } from "../scans-context";

const statusLabels = {
	not_started: "未着手",
	planned: "計画済み",
	in_progress: "対応中",
	fixed: "修正済み",
	accepted: "受容",
	false_positive: "誤検知",
	deferred: "保留",
} as const;

const priorityLabels = {
	p0: "P0",
	p1: "P1",
	p2: "P2",
	p3: "P3",
} as const;

const verificationLabels = {
	not_run: "未実行",
	running: "実行中",
	passed: "合格",
	failed: "失敗",
	inconclusive: "不確定",
} as const;

export function RemediationPlanSection() {
	const c = useScans();
	const plan = c.selectedRemediationPlan;
	if (!plan) return null;
	const hasDecision = Boolean(c.selectedFindingDetails?.latestDecision);
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">Remediation plan</h3>
			<div className="remediation-status-grid">
				<Metric label="状態" value={statusLabels[plan.status]} />
				<Metric label="優先度" value={priorityLabels[plan.priority]} />
				<Metric label="担当" value={plan.owner ?? "未設定"} />
				<Metric
					label="検証"
					value={verificationLabels[plan.verificationStatus]}
				/>
			</div>
			{plan.blockingReasons.length > 0 ? (
				<div className="decision-grade-warning">
					{plan.blockingReasons.join(", ")}
				</div>
			) : null}
			<form className="remediation-form" onSubmit={c.handleRemediationSubmit}>
				<label>
					<span>状態</span>
					<select
						value={c.remediationStatusInput}
						onChange={(event) =>
							c.setRemediationStatusInput(
								event.target.value as typeof c.remediationStatusInput,
							)
						}
						disabled={!hasDecision}
					>
						{Object.entries(statusLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>優先度</span>
					<select
						value={c.remediationPriorityInput}
						onChange={(event) =>
							c.setRemediationPriorityInput(
								event.target.value as typeof c.remediationPriorityInput,
							)
						}
						disabled={!hasDecision}
					>
						{Object.entries(priorityLabels).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
				<label>
					<span>担当</span>
					<input
						value={c.remediationOwnerInput}
						onChange={(event) => c.setRemediationOwnerInput(event.target.value)}
						disabled={!hasDecision}
					/>
				</label>
				<label>
					<span>期限</span>
					<input
						type="date"
						value={c.remediationDueDateInput}
						onChange={(event) =>
							c.setRemediationDueDateInput(event.target.value)
						}
						disabled={!hasDecision}
					/>
				</label>
				<label className="remediation-form-wide">
					<span>修正方針</span>
					<textarea
						rows={3}
						value={c.remediationFixInput}
						onChange={(event) => c.setRemediationFixInput(event.target.value)}
						disabled={!hasDecision}
					/>
				</label>
				<Button
					type="submit"
					variant="secondary"
					disabled={!hasDecision || c.remediationSaveLoading}
				>
					<Save size={14} />
					{c.remediationSaveLoading ? "保存中..." : "計画を保存"}
				</Button>
			</form>
		</div>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="decision-grade-metric">
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}
