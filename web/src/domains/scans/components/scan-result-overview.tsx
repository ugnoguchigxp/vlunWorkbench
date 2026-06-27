import { Code, Copy } from "lucide-react";
import type {
	ScanImprovementRequest,
	ScanReview,
	ToolSummary,
} from "../../../api";
import { Button } from "../../../ui";
import {
	formatScanOutcome,
	getProfileDisplay,
	getToolDisplay,
} from "../scan-profile-display";
import { useScans } from "../scans-context";
import { ExecutiveRiskSummary } from "./executive-risk-summary";
import { ScanComparisonPanel } from "./scan-comparison-panel";
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
	const Heading = headingLevel;

	return (
		<div className="scan-overview-stack">
			<div className="decision-grade-grid">
				<ExecutiveRiskSummary />
				<WorkflowCompletionPanel />
				<ScanComparisonPanel />
			</div>
			<ScanImprovementRequestPanel />
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
					<ContextMetric
						label="レビュー済み"
						value={String(c.scanSummary?.totals.reviewedFindingCount ?? 0)}
					/>
					<ContextMetric
						label="証跡"
						value={String(c.scanSummary?.totals.artifactCount ?? 0)}
					/>
				</div>
				{c.scanSummary?.tools.length ? (
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

function ScanImprovementRequestPanel() {
	const c = useScans();
	const review = c.scanReviews.find((item) => item.status === "completed");
	const request = getImprovementRequest(review);
	if (!request) return null;
	const copyHandoffPrompt = () => {
		if (typeof navigator === "undefined" || !navigator.clipboard) return;
		void navigator.clipboard.writeText(request.handoffPrompt);
	};
	return (
		<section className="decision-grade-panel scan-improvement-request">
			<div className="decision-grade-panel-head">
				<div>
					<span className="scan-review-context-label">LLM handoff</span>
					<h3>
						<Code className="icon" />
						{request.title}
					</h3>
				</div>
				<Button type="button" variant="secondary" onClick={copyHandoffPrompt}>
					<Copy className="icon" />
					コピー
				</Button>
			</div>
			<p>{request.objective}</p>
			{request.implementationTasks.length > 0 ? (
				<div className="decision-grade-list compact">
					{request.implementationTasks.slice(0, 3).map((task) => (
						<div className="decision-grade-list-item" key={task.title}>
							<strong>{task.title}</strong>
							<small>{task.body}</small>
						</div>
					))}
				</div>
			) : null}
			<pre className="remediation-box">
				<code>{request.handoffPrompt}</code>
			</pre>
		</section>
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
				{tool.error ? <small>{tool.error}</small> : null}
			</div>
		</div>
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
