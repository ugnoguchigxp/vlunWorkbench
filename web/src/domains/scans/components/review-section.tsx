import {
	AlertTriangle,
	Brain,
	Code,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { Button } from "../../../ui";
import { useScans } from "../scans-context";
import { formatDateTime, StatusIcon } from "../scans-utils";

export function ReviewSection() {
	const c = useScans();
	const review = c.selectedFindingDetails?.latestReview ?? null;
	return (
		<div className="detail-section">
			<div className="finding-meta-row">
				<h3 className="detail-section-title">LLM Finding Review</h3>
				<Button
					type="button"
					variant="primary"
					onClick={() => void c.handleTriggerReview()}
					disabled={c.busy || c.reviewLoading || review?.status === "running"}
				>
					{c.reviewLoading || review?.status === "running" ? (
						<RefreshCw className="icon animate-spin" />
					) : (
						<Sparkles className="icon" />
					)}
					Run LLM Review
				</Button>
			</div>
			{review ? (
				<div className="detail-section">
					<div className="review-header-panel">
						<div className="review-meta">
							<span>
								<strong>LLM Service:</strong> {review.provider} / {review.model}
							</span>
							<span>
								<strong>Started:</strong> {formatDateTime(review.startedAt)}
							</span>
							{review.completedAt ? (
								<span>
									<strong>Completed:</strong>{" "}
									{formatDateTime(review.completedAt)}
								</span>
							) : null}
						</div>
						<span
							className={`reviewer-header-badge reviewer-badge-${review.status}`}
						>
							<StatusIcon status={review.status} /> {review.status}
						</span>
					</div>
					{review.status === "failed" && review.errorMessage ? (
						<p className="badge-failed">{review.errorMessage}</p>
					) : null}
					{review.status === "completed" ? <CompletedReview /> : null}
				</div>
			) : (
				<p>
					<Brain className="icon text-teal-700" /> No reviews conducted yet.
				</p>
			)}
			{c.allReviews.length > 1 ? (
				<div className="detail-section">
					<h4 className="detail-section-title">
						Prior Reviews ({c.allReviews.length})
					</h4>
					{c.allReviews.map((item) => (
						<div className="finding-meta-row" key={item.id}>
							<small>
								{item.provider} ({item.model}) -{" "}
								{formatDateTime(item.completedAt || item.createdAt)}
							</small>
							<span className={`scan-status-badge badge-${item.status}`}>
								{item.status}
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function CompletedReview() {
	const review = useScans().selectedFindingDetails?.latestReview;
	if (!review) return null;
	return (
		<>
			<div className="assessment-grid">
				{review.falsePositiveAssessment ? (
					<div className="assessment-card">
						<div className="assessment-card-header">
							<span className="assessment-card-title">False Positive</span>
							<span
								className={`assessment-card-value val-fp-${review.falsePositiveAssessment.level}`}
							>
								{review.falsePositiveAssessment.level}
							</span>
						</div>
						<p className="assessment-card-reasoning">
							{review.falsePositiveAssessment.reasoning}
						</p>
					</div>
				) : null}
				{review.evidenceStrength ? (
					<div className="assessment-card">
						<div className="assessment-card-header">
							<span className="assessment-card-title">Evidence Strength</span>
							<span
								className={`assessment-card-value val-strength-${review.evidenceStrength.level}`}
							>
								{review.evidenceStrength.level}
							</span>
						</div>
						<p className="assessment-card-reasoning">
							{review.evidenceStrength.reasoning}
						</p>
					</div>
				) : null}
				{review.confidenceAdjustment ? (
					<div className="assessment-card">
						<div className="assessment-card-header">
							<span className="assessment-card-title">Confidence Adj.</span>
							<span
								className={`assessment-card-value val-adj-${review.confidenceAdjustment}`}
							>
								{review.confidenceAdjustment}
							</span>
						</div>
					</div>
				) : null}
			</div>
			{review.likelyImpact ? (
				<div className="detail-section">
					<strong>
						<AlertTriangle className="icon" /> Likely Impact
					</strong>
					<p>{review.likelyImpact}</p>
				</div>
			) : null}
			{review.remediationDirection ? (
				<div className="detail-section">
					<strong>
						<Code className="icon" /> Remediation Direction
					</strong>
					<pre className="remediation-box">
						<code>{review.remediationDirection}</code>
					</pre>
				</div>
			) : null}
			{review.reviewerNotes?.length ? (
				<div className="detail-section">
					<strong>
						<Info className="icon" /> Additional Notes
					</strong>
					<ul className="notes-list">
						{review.reviewerNotes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</div>
			) : null}
		</>
	);
}
