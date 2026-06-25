import { Brain, Shield } from "lucide-react";
import { Button } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime } from "../scans-utils";

export function DecisionSection() {
	const c = useScans();
	return (
		<div className="detail-section">
			<h3 className="detail-section-title">
				<Shield className="icon text-teal-700" /> Reviewer Decision
			</h3>
			<div className="decision-panel">
				<form onSubmit={c.handleDecisionSubmit} className="detail-section">
					<div className="decision-form-row">
						<label className="decision-form-field">
							<span>Decision State</span>
							<select
								value={c.decisionInput}
								onChange={(event) =>
									c.setDecisionInput(
										event.target.value as typeof c.decisionInput,
									)
								}
								required
							>
								<option value="accepted">Accepted</option>
								<option value="false_positive">False Positive</option>
								<option value="deferred">Deferred</option>
								<option value="needs_fix">Needs Fix</option>
							</select>
						</label>
						<label className="decision-form-field">
							<span>Reason</span>
							<select
								value={c.reasonInput}
								onChange={(event) =>
									c.setReasonInput(event.target.value as typeof c.reasonInput)
								}
								required
							>
								<option value="confirmed_by_evidence">
									Confirmed by Evidence
								</option>
								<option value="confirmed_by_review">Confirmed by Review</option>
								<option value="insufficient_evidence">
									Insufficient Evidence
								</option>
								<option value="environment_specific">
									Environment Specific
								</option>
								<option value="tool_noise">Tool Noise</option>
								<option value="not_exploitable">Not Exploitable</option>
								<option value="accepted_risk">Accepted Risk</option>
								<option value="other">Other</option>
							</select>
						</label>
					</div>
					<label className="decision-form-field">
						<span>Comment / Rationale</span>
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
							Link to latest LLM Review (
							{c.selectedFindingDetails.latestReview.model})
						</label>
					) : null}
					<Button
						type="submit"
						variant="primary"
						disabled={c.busy || c.decisionSubmitLoading}
					>
						{c.decisionSubmitLoading ? "Submitting..." : "Record Decision"}
					</Button>
				</form>
			</div>
			{c.allDecisions.length > 0 ? (
				<div className="detail-section">
					<h4 className="detail-section-title">Decision History</h4>
					{c.allDecisions.map((decision, index) => (
						<div
							key={decision.id}
							className={`timeline-item ${index === 0 ? "active-node" : ""}`}
						>
							<div className="detail-section">
								<div className="finding-meta-row">
									<span className={`decision-badge badge-${decision.decision}`}>
										{decision.decision.replace("_", " ")}
									</span>
									<small>Reason: {decision.reason.replace(/_/g, " ")}</small>
									<small>{formatDateTime(decision.createdAt)}</small>
								</div>
								{decision.comment ? <p>"{decision.comment}"</p> : null}
								{decision.linkedReviewId ? (
									<small>
										<Brain size={12} /> Linked to LLM Review
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
