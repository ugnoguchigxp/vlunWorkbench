import { RefreshCw, Sparkles } from "lucide-react";
import type { Finding, ScanReview, ScanRun } from "../../../api";
import { Button } from "../../../ui";
import {
	buildScanImprovementRequestView,
	classifyScanReviewFailure,
} from "./scan-improvement-request";
import { ScanImprovementRequestPanel } from "./scan-improvement-request-panel";

type ScanImprovementRequestGeneratorProps = {
	scanRun: ScanRun | null;
	findings: Finding[];
	reviews: ScanReview[];
	generating: boolean;
	onGenerate: () => void;
};

export function ScanImprovementRequestGenerator({
	scanRun,
	findings,
	reviews,
	generating,
	onGenerate,
}: ScanImprovementRequestGeneratorProps) {
	const view = buildScanImprovementRequestView(reviews);
	const runningReview = reviews.find(
		(review) =>
			review.status === "running" &&
			review.inputBundle?.generationKind === "improvement_request",
	);
	const failedReview = reviews.find(
		(review) =>
			review.status === "failed" &&
			review.inputBundle?.generationKind === "improvement_request",
	);
	const failure = classifyScanReviewFailure(failedReview?.errorMessage);
	const busy = generating || Boolean(runningReview);
	const completedScan = scanRun?.status === "completed";
	const completeCoverage = view.coverage.status === "complete";
	const buttonLabel = busy
		? "指示書を生成中..."
		: completeCoverage
			? "指示書を再生成"
			: failedReview
				? "指示書の生成を再試行"
				: "指示書を生成";

	return (
		<section className="workspace-improvement-request-generator">
			<div className="workspace-improvement-request-heading">
				<div>
					<span className="scan-review-context-label">検出結果を一括整理</span>
					<h3>LLMへの改修依頼指示書</h3>
					<p>
						重複を統合した issue
						と保存済み証跡をまとめ、実装担当のLLMへ渡せる指示書を生成します。
					</p>
				</div>
				<Button
					type="button"
					variant="primary"
					onClick={onGenerate}
					disabled={!scanRun || !completedScan || busy}
				>
					{busy ? (
						<RefreshCw className="icon animate-spin" />
					) : (
						<Sparkles className="icon" />
					)}
					{buttonLabel}
				</Button>
			</div>
			{!completedScan && scanRun ? (
				<p className="workspace-improvement-request-status">
					スキャン完了後に指示書を生成できます。
				</p>
			) : null}
			{busy ? (
				<p className="workspace-improvement-request-status" role="status">
					検出結果を集約し、改修タスクと受け入れ条件を作成しています。
				</p>
			) : null}
			{view.available && view.coverage.status !== "complete" ? (
				<p className="workspace-improvement-request-warning" role="status">
					{view.coverage.status === "partial"
						? view.coverage.totalIssues !== null
							? `現在の指示書は ${view.coverage.includedIssues ?? 0} / ${view.coverage.totalIssues} issues を対象にしています。全件版を生成してください。`
							: `現在の指示書は ${view.coverage.includedFindings ?? 0} / ${view.coverage.totalFindings ?? findings.length} 件を対象にしています。全件版を生成してください。`
						: "現在の指示書は対象件数を確認できません。全件版の再生成を推奨します。"}
				</p>
			) : null}
			{failure && !busy && !completeCoverage ? (
				<div className="scan-review-failure">
					<strong>{failure.label}</strong>
					<span>{failure.nextAction}</span>
					<code>{failure.rawError}</code>
				</div>
			) : null}
			<ScanImprovementRequestPanel view={view} />
		</section>
	);
}
