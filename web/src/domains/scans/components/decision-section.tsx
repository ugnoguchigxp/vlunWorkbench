import { Brain, Shield } from "lucide-react";
import { Button } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";

const DECISION_LABELS = {
	accepted: "リスク受容",
	false_positive: "誤検知",
	deferred: "保留",
	needs_fix: "要修正",
} as const;

const REASON_LABELS = {
	confirmed_by_evidence: "証跡で確認済み",
	confirmed_by_review: "レビューで確認済み",
	insufficient_evidence: "証跡不足",
	environment_specific: "環境依存",
	tool_noise: "ツールのノイズ",
	not_exploitable: "悪用困難",
	accepted_risk: "リスク受容",
	other: "その他",
} as const;

export function DecisionSection() {
	const c = useScans();
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<Shield className="icon text-teal-700" /> レビュアー判断
			</h3>
			<div className="decision-panel">
				<form onSubmit={c.handleDecisionSubmit} className="detail-section">
					<div className="decision-form-row">
						<label className="decision-form-field">
							<span>判断</span>
							<select
								value={c.decisionInput}
								onChange={(event) =>
									c.setDecisionInput(
										event.target.value as typeof c.decisionInput,
									)
								}
								required
							>
								<option value="accepted">リスク受容</option>
								<option value="false_positive">誤検知</option>
								<option value="deferred">保留</option>
								<option value="needs_fix">要修正</option>
							</select>
						</label>
						<label className="decision-form-field">
							<span>理由</span>
							<select
								value={c.reasonInput}
								onChange={(event) =>
									c.setReasonInput(event.target.value as typeof c.reasonInput)
								}
								required
							>
								<option value="confirmed_by_evidence">証跡で確認済み</option>
								<option value="confirmed_by_review">レビューで確認済み</option>
								<option value="insufficient_evidence">証跡不足</option>
								<option value="environment_specific">環境依存</option>
								<option value="tool_noise">ツールのノイズ</option>
								<option value="not_exploitable">悪用困難</option>
								<option value="accepted_risk">リスク受容</option>
								<option value="other">その他</option>
							</select>
						</label>
					</div>
					<label className="decision-form-field">
						<span>コメント / 判断根拠</span>
						<textarea
							rows={3}
							value={c.commentInput}
							onChange={(event) => c.setCommentInput(event.target.value)}
						/>
					</label>
					{c.selectedFindingDetails?.latestReview ? (
						<label>
							<input
								type="checkbox"
								checked={c.linkReviewInput}
								onChange={(event) => c.setLinkReviewInput(event.target.checked)}
							/>{" "}
							最新の LLM レビューに紐づける (
							{c.selectedFindingDetails.latestReview.model})
						</label>
					) : null}
					<Button
						type="submit"
						variant="primary"
						disabled={c.busy || c.decisionSubmitLoading}
					>
						{c.decisionSubmitLoading ? "送信中..." : "判断を記録"}
					</Button>
				</form>
			</div>
			{c.allDecisions.length > 0 ? (
				<div className="detail-section">
					<h4 className="detail-section-title">判断履歴</h4>
					{c.allDecisions.map((decision, index) => (
						<div
							key={decision.id}
							className={`timeline-item ${index === 0 ? "active-node" : ""}`}
						>
							<div className="detail-section">
								<div className="finding-meta-row">
									<span className={`decision-badge badge-${decision.decision}`}>
										{DECISION_LABELS[decision.decision]}
									</span>
									<small>理由: {REASON_LABELS[decision.reason]}</small>
									<small>{formatDateTime(decision.createdAt)}</small>
								</div>
								{decision.comment ? <p>"{decision.comment}"</p> : null}
								{decision.linkedReviewId ? (
									<small>
										<Brain size={12} /> LLM レビューに紐づけ済み
									</small>
								) : null}
							</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
