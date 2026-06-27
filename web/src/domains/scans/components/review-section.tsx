import {
	AlertTriangle,
	Brain,
	Code,
	Copy,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import type { ScanImprovementRequest, ScanReview } from "../../../api";
import { Button } from "../../../ui";
import { formatScanOutcome } from "../scan-profile-display";
import { useScans } from "../scans-context";
import { formatDateTime, StatusIcon } from "../scans-utils";
import { ScanResultOverview } from "./scan-result-overview";

export function ReviewSection() {
	const c = useScans();
	const review = c.selectedFindingDetails?.latestReview ?? null;
	const latestScanReview = c.scanReviews.find(
		(item) => item.status === "completed",
	);
	const improvementRequest = getImprovementRequest(latestScanReview);
	return (
		<div className="detail-section">
			<ScanResultOverview headingLevel="h3" />
			{improvementRequest ? (
				<ImprovementRequestSection
					request={improvementRequest}
					review={latestScanReview}
				/>
			) : null}
			<div className="finding-meta-row">
				<div>
					<h3 className="detail-section-title">LLM レビュー</h3>
					<p className="scan-tool-purpose">
						選択した finding
						について、誤検知の可能性、証跡の強さ、影響、修正方針を確認します。
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
						<p className="badge-failed">{review.errorMessage}</p>
					) : null}
					{review.status === "completed" ? <CompletedReview /> : null}
				</div>
			) : (
				<p>
					<Brain className="icon text-teal-700" /> LLM
					レビューはまだ実行されていません。
				</p>
			)}
			{c.reviewError ? <p className="badge-failed">{c.reviewError}</p> : null}
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

function getImprovementRequest(
	review: ScanReview | undefined,
): ScanImprovementRequest | null {
	const value = review?.output?.improvementRequest;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<ScanImprovementRequest>;
	return typeof candidate.title === "string" &&
		typeof candidate.objective === "string" &&
		typeof candidate.handoffPrompt === "string" &&
		Array.isArray(candidate.scope) &&
		Array.isArray(candidate.priorityPlan) &&
		Array.isArray(candidate.implementationTasks) &&
		Array.isArray(candidate.acceptanceCriteria) &&
		Array.isArray(candidate.verificationCommands) &&
		Array.isArray(candidate.constraints) &&
		Array.isArray(candidate.nonGoals)
		? (candidate as ScanImprovementRequest)
		: null;
}

function ImprovementRequestSection({
	request,
	review,
}: {
	request: ScanImprovementRequest;
	review?: ScanReview;
}) {
	const copyHandoffPrompt = () => {
		if (typeof navigator === "undefined" || !navigator.clipboard) return;
		void navigator.clipboard.writeText(request.handoffPrompt);
	};
	return (
		<div className="detail-section">
			<div className="finding-meta-row">
				<div>
					<h3 className="detail-section-title">
						<Code className="icon text-teal-700" /> 改善依頼書
					</h3>
					<p className="scan-tool-purpose">{request.objective}</p>
				</div>
				<Button type="button" variant="secondary" onClick={copyHandoffPrompt}>
					<Copy className="icon" />
					Handoff をコピー
				</Button>
			</div>
			<div className="review-header-panel">
				<div className="review-meta">
					<span>
						<strong>Title:</strong> {request.title}
					</span>
					{review ? (
						<span>
							<strong>Scan Review:</strong> {review.provider} / {review.model}
						</span>
					) : null}
					{review?.completedAt ? (
						<span>
							<strong>完了:</strong> {formatDateTime(review.completedAt)}
						</span>
					) : null}
				</div>
			</div>
			{request.priorityPlan.length > 0 ? (
				<div className="assessment-grid">
					{request.priorityPlan.map((item) => (
						<div
							className="assessment-card"
							key={`${item.priority}-${item.findingIds.join("-")}`}
						>
							<div className="assessment-card-header">
								<span className="assessment-card-title">優先度</span>
								<span className="assessment-card-value">{item.priority}</span>
							</div>
							<p className="assessment-card-reasoning">{item.rationale}</p>
							<small>{item.findingIds.join(", ")}</small>
						</div>
					))}
				</div>
			) : null}
			{request.implementationTasks.length > 0 ? (
				<div className="detail-section">
					<strong>実装タスク</strong>
					<ul className="notes-list">
						{request.implementationTasks.map((task) => (
							<li key={`${task.title}-${task.findingIds.join("-")}`}>
								<strong>{task.title}</strong>
								<br />
								{task.body}
								<br />
								<small>{task.findingIds.join(", ")}</small>
							</li>
						))}
					</ul>
				</div>
			) : null}
			{request.acceptanceCriteria.length > 0 ? (
				<div className="detail-section">
					<strong>受け入れ条件</strong>
					<ul className="notes-list">
						{request.acceptanceCriteria.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
			) : null}
			{request.verificationCommands.length > 0 ? (
				<div className="detail-section">
					<strong>検証コマンド</strong>
					<ul className="notes-list">
						{request.verificationCommands.map((item) => (
							<li key={item}>
								<code>{item}</code>
							</li>
						))}
					</ul>
				</div>
			) : null}
			<pre className="remediation-box">
				<code>{request.handoffPrompt}</code>
			</pre>
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
