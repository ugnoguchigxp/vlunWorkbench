import type { StepSummary, ToolSummary } from "../../../api";
import {
	formatScanOutcome,
	formatScanReason,
	getProfileDisplay,
	getToolDisplay,
} from "../scan-profile-display";
import {
	buildScanImprovementRequestView,
	classifyScanReviewFailure,
} from "../scan-improvement-request";
import { readDiffTargetDisplay } from "../diff-target-display";
import { useScans } from "../scans-context";
import { ExecutiveRiskSummary } from "./executive-risk-summary";
import { ScanComparisonPanel } from "./scan-comparison-panel";
import { ScanImprovementRequestPanel } from "./scan-improvement-request-panel";
import { WorkflowCompletionPanel } from "./workflow-completion-panel";

type ScanResultOverviewProps = {
	headingLevel?: "h2" | "h3";
};

export function ScanResultOverview({
	headingLevel = "h2",
}: ScanResultOverviewProps) {
	const c = useScans();
	const scanRun =
		c.scanRuns.find((run) => run.id === c.selectedScanRunId) ?? null;
	const profileId = c.scanSummary?.profileId ?? scanRun?.profile ?? "";
	const profile = c.profiles.find((item) => item.id === profileId) ?? null;
	const display = getProfileDisplay(
		profileId,
		profile?.name ?? "不明なスキャン",
		profile?.description ??
			"過去の scan run です。保存済み結果から内容を確認します。",
	);
	const outcome = c.scanSummary?.profileOutcome ?? scanRun?.status ?? null;
	const diffTarget = readDiffTargetDisplay(scanRun?.metadata);
	const latestScanReview = c.scanReviews[0] ?? null;
	const latestCompletedScanReview =
		c.scanReviews.find((item) => item.status === "completed") ?? null;
	const latestFailedScanReview =
		latestScanReview?.status === "failed" ? latestScanReview : null;
	const handoffView = buildScanImprovementRequestView(c.scanReviews);
	const scanReviewFailure = classifyScanReviewFailure(
		latestFailedScanReview?.errorMessage,
	);
	const Heading = headingLevel;

	return (
		<div className="scan-overview-stack">
			<div className="decision-grade-grid">
				<ExecutiveRiskSummary />
				<WorkflowCompletionPanel />
				<ScanComparisonPanel />
			</div>
			<ScanImprovementRequestPanel
				view={handoffView}
				completedAt={latestCompletedScanReview?.completedAt}
				providerLabel={
					latestCompletedScanReview
						? `${latestCompletedScanReview.provider} / ${latestCompletedScanReview.model}`
						: null
				}
				compact
			/>
			{scanReviewFailure ? (
				<div className="scan-review-failure">
					<strong>{scanReviewFailure.label}</strong>
					<span>{scanReviewFailure.nextAction}</span>
					<code>{scanReviewFailure.rawError}</code>
				</div>
			) : null}
			<div className="scan-review-context">
				<div className="scan-review-context-main">
					<div>
						<span className="scan-review-context-label">スキャン結果</span>
						<Heading>{display.name}</Heading>
						<p>{display.subtitle}</p>
					</div>
					<span className={`scan-status-badge badge-${outcome ?? "unknown"}`}>
						{formatScanOutcome(outcome)}
					</span>
				</div>
				<div className="scan-review-context-metrics">
					<ContextMetric
						label="実行状態"
						value={formatScanOutcome(scanRun?.status)}
					/>
					<ContextMetric
						label="検出数"
						value={String(
							c.scanSummary?.totals.findingCount ?? c.findings.length,
						)}
					/>
					{diffTarget ? (
						<>
							<ContextMetric label="差分対象" value={diffTarget.label} />
							<ContextMetric
								label="差分coverage"
								value={
									diffTarget.coverage
										? `${diffTarget.coverage.scannable}/${diffTarget.coverage.changed} files`
										: "不明"
								}
							/>
							<ContextMetric label="Target digest" value={diffTarget.digest} />
						</>
					) : null}
					<ContextMetric
						label="レビュー済み"
						value={String(c.scanSummary?.totals.reviewedFindingCount ?? 0)}
					/>
					<ContextMetric
						label="証跡"
						value={String(c.scanSummary?.totals.artifactCount ?? 0)}
					/>
				</div>
				{c.scanSummary?.steps?.length ? (
					<div className="scan-result-tool-list">
						{c.scanSummary.steps.map((step) => (
							<StepResultRow key={step.id} step={step} />
						))}
					</div>
				) : c.scanSummary?.tools.length ? (
					<div className="scan-result-tool-list">
						{c.scanSummary.tools.map((tool) => (
							<ToolResultRow key={tool.toolId} tool={tool} />
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}

function StepResultRow({ step }: { step: StepSummary }) {
	const display =
		step.kind === "static_tool"
			? getToolDisplay(step.id)
			: {
					name: step.displayName,
					purpose: step.targetOrigin
						? `HTTP実行時証跡: ${step.targetOrigin}`
						: "自動判別したローカル対象から HTTP 実行時証跡を取得します",
				};
	const detail =
		step.kind === "dast" && step.outcome
			? `${step.findingCount} 件 / ${step.outcome}`
			: `${step.findingCount} 件${step.coverageEffect === "gap" ? " / coverage gap" : ""}`;
	return (
		<div className="scan-result-tool-row">
			<div className="scan-result-tool-copy">
				<strong>{display.name}</strong>
				<span>{display.purpose}</span>
			</div>
			<div className="scan-result-tool-result">
				<span className={`scan-status-badge badge-${step.status}`}>
					{formatScanOutcome(step.status)}
				</span>
				<span>{detail}</span>
				{step.kind === "static_tool" ? (
					<span>{step.artifactCount} 証跡</span>
				) : null}
				{step.error ? <small>{step.error}</small> : null}
				{step.reasonCode ? (
					<small>理由: {formatScanReason(step.reasonCode)}</small>
				) : null}
				{step.coverageEffect ? (
					<small>カバレッジ: {step.coverageEffect}</small>
				) : null}
				{step.metadata?.imageDigest ? (
					<small>image: {String(step.metadata.imageDigest)}</small>
				) : null}
				{formatGatewayMetrics(step.metadata)}
			</div>
		</div>
	);
}

function ToolResultRow({ tool }: { tool: ToolSummary }) {
	const display = getToolDisplay(tool.toolId);
	return (
		<div className="scan-result-tool-row">
			<div className="scan-result-tool-copy">
				<strong>{display.name}</strong>
				<span>{display.purpose}</span>
			</div>
			<div className="scan-result-tool-result">
				<span className={`scan-status-badge badge-${tool.status}`}>
					{formatScanOutcome(tool.status)}
				</span>
				<span>{tool.findingCount} 件</span>
				<span>{tool.artifactCount} 証跡</span>
				{tool.toolVersion ? <small>version {tool.toolVersion}</small> : null}
				{tool.metadata?.imageDigest ? (
					<small>image: {String(tool.metadata.imageDigest)}</small>
				) : null}
				{formatGatewayMetrics(tool.metadata)}
				{tool.error ? <small>{tool.error}</small> : null}
			</div>
		</div>
	);
}

function formatGatewayMetrics(metadata?: Record<string, unknown>) {
	const metrics = metadata?.gatewayMetrics;
	if (!metrics || typeof metrics !== "object") return null;
	const values = metrics as Record<string, unknown>;
	return (
		<small>
			対象転送: {String(values.forwardedRequests ?? 0)} / 予算超過:{" "}
			{String(values.budgetBlockedRequests ?? 0)}
		</small>
	);
}

function ContextMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="scan-review-context-metric">
			<small>{label}</small>
			<strong>{value}</strong>
		</div>
	);
}
