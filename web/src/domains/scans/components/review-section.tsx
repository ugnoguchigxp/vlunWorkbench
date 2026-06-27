import {
	AlertTriangle,
	Brain,
	Code,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { Button } from "../../../ui";
import { formatScanOutcome } from "../scan-profile-display";
import {
	buildScanImprovementRequestView,
	classifyScanReviewFailure,
} from "../scan-improvement-request";
import { useScans } from "../scans-context";
import { formatDateTime, StatusIcon } from "../scans-utils";
import { ScanImprovementRequestPanel } from "./scan-improvement-request-panel";

export function ReviewSection() {
	const c = useScans();
	const review = c.selectedFindingDetails?.latestReview ?? null;
	const latestScanReview = c.scanReviews.find(
		(item) => item.status === "completed",
	);
	const handoffView = buildScanImprovementRequestView(c.scanReviews);
	return (
		<div className="detail-section">
			<ScanImprovementRequestPanel
				view={handoffView}
				completedAt={latestScanReview?.completedAt}
				providerLabel={
					latestScanReview
						? `${latestScanReview.provider} / ${latestScanReview.model}`
						: null
				}
			/>
			<div className="finding-meta-row">
				<div>
					<h3 className="detail-section-title">LLM レビュー</h3>
					<p className="scan-tool-purpose">
						選択した finding
						について、保存済み証跡から誤検知の可能性、証跡の強さ、影響、修正方針を自動レビューします。
					</p>
				</div>
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
					LLM レビューを実行
				</Button>
			</div>
			{review ? (
				<div className="detail-section">
					<div className="review-header-panel">
						<div className="review-meta">
							<span>
								<strong>LLM:</strong> {review.provider} / {review.model}
							</span>
							<span>
								<strong>開始:</strong> {formatDateTime(review.startedAt)}
							</span>
							{review.completedAt ? (
								<span>
									<strong>完了:</strong> {formatDateTime(review.completedAt)}
								</span>
							) : null}
						</div>
						<span
							className={`reviewer-header-badge reviewer-badge-${review.status}`}
						>
							<StatusIcon status={review.status} />{" "}
							{formatScanOutcome(review.status)}
						</span>
					</div>
					{review.status === "failed" && review.errorMessage ? (
						<ScanReviewFailureMessage error={review.errorMessage} />
					) : null}
					{review.status === "completed" ? <CompletedReview /> : null}
				</div>
			) : (
				<p>
					<Brain className="icon text-teal-700" /> LLM
					レビューはまだ実行されていません。
				</p>
			)}
			{c.reviewError ? (
				<ScanReviewFailureMessage error={c.reviewError} />
			) : null}
			{c.allReviews.length > 1 ? (
				<div className="detail-section">
					<h4 className="detail-section-title">
						過去のレビュー ({c.allReviews.length})
					</h4>
					{c.allReviews.map((item) => (
						<div className="finding-meta-row" key={item.id}>
							<small>
								{item.provider} ({item.model}) -{" "}
								{formatDateTime(item.completedAt || item.createdAt)}
							</small>
							<span className={`scan-status-badge badge-${item.status}`}>
								{formatScanOutcome(item.status)}
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

function ScanReviewFailureMessage({ error }: { error: string }) {
	const failure = classifyScanReviewFailure(error);
	if (!failure) return null;
	return (
		<div className="scan-review-failure">
			<strong>{failure.label}</strong>
			<span>{failure.nextAction}</span>
			<code>{failure.rawError}</code>
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
							<span className="assessment-card-title">誤検知の可能性</span>
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
							<span className="assessment-card-title">証跡の強さ</span>
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
							<span className="assessment-card-title">信頼度補正</span>
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
						<AlertTriangle className="icon" /> 想定される影響
					</strong>
					<p>{review.likelyImpact}</p>
				</div>
			) : null}
			{review.remediationDirection ? (
				<div className="detail-section">
					<strong>
						<Code className="icon" /> 修正方針
					</strong>
					<pre className="remediation-box">
						<code>{review.remediationDirection}</code>
					</pre>
				</div>
			) : null}
			{review.reviewerNotes?.length ? (
				<div className="detail-section">
					<strong>
						<Info className="icon" /> 補足メモ
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
