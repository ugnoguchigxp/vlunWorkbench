import { Brain, Shield } from "lucide-react";
import { Button } from "../../../ui";
import { buildScanImprovementRequestView } from "../scan-improvement-request";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";

const DECISION_LABELS = {
	accepted: "既知リスク記録",
	false_positive: "ツールノイズ記録",
	deferred: "後続確認記録",
	needs_fix: "実装改善候補",
} as const;

const REASON_LABELS = {
	confirmed_by_evidence: "証跡で確認済み",
	confirmed_by_review: "レビューで確認済み",
	insufficient_evidence: "証跡不足",
	environment_specific: "環境依存",
	tool_noise: "ツールのノイズ",
	not_exploitable: "悪用困難",
	accepted_risk: "既知リスク",
	other: "その他",
} as const;

export function DecisionSection() {
	const c = useScans();
	const hasScanHandoff = buildScanImprovementRequestView(
		c.scanReviews,
	).available;
	const form = (
		<div className="decision-panel">
			<form onSubmit={c.handleDecisionSubmit} className="detail-section">
				<div className="decision-form-row">
					<label className="decision-form-field">
						<span>互換用分類</span>
						<select
							value={c.decisionInput}
							onChange={(event) =>
								c.setDecisionInput(event.target.value as typeof c.decisionInput)
							}
							required
						>
							<option value="needs_fix">実装改善候補</option>
							<option value="accepted">既知リスク記録</option>
							<option value="false_positive">ツールノイズ記録</option>
							<option value="deferred">後続確認記録</option>
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
							<option value="accepted_risk">既知リスク</option>
							<option value="other">その他</option>
						</select>
					</label>
				</div>
				<label className="decision-form-field">
					<span>補足 / リスク伝達メモ</span>
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
					variant="secondary"
					disabled={c.busy || c.decisionSubmitLoading}
				>
					{c.decisionSubmitLoading ? "送信中..." : "互換記録を保存"}
				</Button>
			</form>
		</div>
	);
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<Shield className="icon text-teal-700" /> 互換用 Decision 記録
			</h3>
			<p className="scan-tool-purpose">
				{hasScanHandoff
					? "主成果物は、次の LLM にリスクと実装改善を渡す scan-level handoff です。Decision は通常フロー外の互換記録としてのみ扱います。"
					: "通常フローは LLM review / handoff 生成です。危うい finding は人が仕分けるのではなく、実装改善のリスク文脈として渡します。"}
			</p>
			<details className="decision-audit-details">
				<summary>例外的に互換用 Decision 記録を保存する</summary>
				{form}
			</details>
			{c.allDecisions.length > 0 ? (
				<div className="detail-section">
					<h4 className="detail-section-title">互換記録履歴</h4>
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
