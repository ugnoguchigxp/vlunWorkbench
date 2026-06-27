import type {
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingReview,
	ReproductionRun,
} from "../../api";

export type ReportDecisionBucket = FindingDecision["decision"] | "undecided";

export type DecisionWorkflowEvidenceKind =
	| "source"
	| "tool_output"
	| "scan_log"
	| "review"
	| "reproduction"
	| "dynamic"
	| "dast";

export type DecisionWorkflowView = {
	findingId: string;
	latestDecision: FindingDecision | null;
	latestReview: FindingReview | null;
	decisionState: "missing" | "complete" | "needs_context";
	evidenceChecklist: Array<{
		id: string;
		label: string;
		kind: DecisionWorkflowEvidenceKind;
		available: boolean;
		reference?: string;
	}>;
	reportImpact: {
		bucket: ReportDecisionBucket;
		label: string;
		includedByDefault: boolean;
	};
	recommendedReason: FindingDecision["reason"] | null;
	missingInputs: string[];
};

export type DecisionWorkflowReportOptions = {
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
};

export type BuildDecisionWorkflowInput = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestDecision: FindingDecision | null;
	latestReview: FindingReview | null;
	reproductions?: ReproductionRun[];
	dynamicRuns?: DynamicRun[];
	dastEvidence?: Array<{
		id: string;
		title?: string;
		kind?: string;
		findingId?: string | null;
	}>;
	reportOptions: DecisionWorkflowReportOptions;
};

const REPORT_LABELS: Record<ReportDecisionBucket, string> = {
	needs_fix: "要修正",
	accepted: "リスク受容",
	deferred: "保留",
	false_positive: "誤検知",
	undecided: "未判断",
};

const formatLocationReference = (location: unknown): string | undefined => {
	if (!location || typeof location !== "object") return undefined;
	const record = location as Record<string, unknown>;
	const path = typeof record.path === "string" ? record.path : "";
	if (!path) return undefined;
	const line =
		typeof record.startLine === "number" || typeof record.startLine === "string"
			? String(record.startLine)
			: "";
	return line ? `${path}:${line}` : path;
};

const hasMetadataSnippet = (finding: Finding): boolean =>
	typeof finding.metadata?.snippet === "string" &&
	finding.metadata.snippet.trim().length > 0;

const hasPrimarySource = (
	finding: Finding,
	evidence: FindingEvidence[],
): boolean =>
	Boolean(formatLocationReference(finding.primaryLocation)) ||
	hasMetadataSnippet(finding) ||
	evidence.some(
		(item) =>
			item.kind === "source-location" &&
			(Boolean(formatLocationReference(item.location)) ||
				Boolean(item.snippet?.trim())),
	);

const summarizeRun = (status?: string, outcome?: string | null): string => {
	const parts = [status, outcome].filter(Boolean);
	return parts.length > 0 ? parts.join(" / ") : "記録あり";
};

export function mapDecisionToReportBucket(
	decision: FindingDecision | null,
	reportOptions: DecisionWorkflowReportOptions,
): DecisionWorkflowView["reportImpact"] {
	const bucket: ReportDecisionBucket = decision?.decision ?? "undecided";
	const includedByDefault =
		bucket === "needs_fix" ||
		bucket === "accepted" ||
		(bucket === "deferred" && reportOptions.includeDeferred) ||
		(bucket === "false_positive" && reportOptions.includeFalsePositives) ||
		(bucket === "undecided" && reportOptions.includeUndecided);

	return {
		bucket,
		label: REPORT_LABELS[bucket],
		includedByDefault,
	};
}

export function buildEvidenceChecklist(
	input: BuildDecisionWorkflowInput,
): DecisionWorkflowView["evidenceChecklist"] {
	const sourceEvidence = input.evidence.find(
		(item) => item.kind === "source-location",
	);
	const toolOutputEvidence = input.evidence.find(
		(item) => item.kind === "tool-output",
	);
	const scanLogEvidence = input.evidence.find(
		(item) => item.kind === "scan-log",
	);
	const sourceReference =
		formatLocationReference(input.finding.primaryLocation) ||
		formatLocationReference(sourceEvidence?.location) ||
		(sourceEvidence?.snippet ? sourceEvidence.title : undefined) ||
		(hasMetadataSnippet(input.finding)
			? "メタデータ内のスニペット"
			: undefined);
	const latestReproduction = input.reproductions?.[0] ?? null;
	const latestDynamicRun = input.dynamicRuns?.[0] ?? null;
	const latestDastEvidence = input.dastEvidence?.[0] ?? null;

	const checklist: DecisionWorkflowView["evidenceChecklist"] = [
		{
			id: "source",
			label: "主な検出位置またはスニペット",
			kind: "source",
			available: Boolean(sourceReference),
			reference: sourceReference,
		},
		{
			id: "tool-output",
			label: "ツール出力の証跡",
			kind: "tool_output",
			available: Boolean(toolOutputEvidence),
			reference:
				toolOutputEvidence?.title ||
				(toolOutputEvidence?.artifactId
					? `アーティファクト ${toolOutputEvidence.artifactId.slice(0, 8)}`
					: undefined),
		},
		{
			id: "scan-log",
			label: "スキャンログの証跡",
			kind: "scan_log",
			available: Boolean(scanLogEvidence),
			reference:
				scanLogEvidence?.title ||
				(scanLogEvidence?.artifactId
					? `アーティファクト ${scanLogEvidence.artifactId.slice(0, 8)}`
					: undefined),
		},
		{
			id: "review",
			label: "最新の LLM レビュー",
			kind: "review",
			available: Boolean(input.latestReview),
			reference: input.latestReview
				? `${input.latestReview.provider} / ${input.latestReview.model}`
				: undefined,
		},
	];

	if (input.reproductions) {
		checklist.push({
			id: "reproduction",
			label: "サンドボックス再現確認",
			kind: "reproduction",
			available: Boolean(latestReproduction),
			reference: latestReproduction
				? summarizeRun(latestReproduction.status, latestReproduction.outcome)
				: undefined,
		});
	}

	if (input.dynamicRuns) {
		checklist.push({
			id: "dynamic",
			label: "動的検証",
			kind: "dynamic",
			available: Boolean(latestDynamicRun),
			reference: latestDynamicRun
				? summarizeRun(latestDynamicRun.status, latestDynamicRun.outcome)
				: undefined,
		});
	}

	if (input.dastEvidence) {
		checklist.push({
			id: "dast",
			label: "DAST 証跡",
			kind: "dast",
			available: Boolean(latestDastEvidence),
			reference: latestDastEvidence
				? latestDastEvidence.title || latestDastEvidence.kind
				: undefined,
		});
	}

	return checklist;
}

const recommendReason = (
	input: BuildDecisionWorkflowInput,
	checklist: DecisionWorkflowView["evidenceChecklist"],
): FindingDecision["reason"] | null => {
	if (input.latestDecision) return null;
	if (!checklist.some((item) => item.available && item.kind !== "review")) {
		return "insufficient_evidence";
	}
	if (input.latestReview) return "confirmed_by_review";
	return "confirmed_by_evidence";
};

export function buildDecisionWorkflow(
	input: BuildDecisionWorkflowInput,
): DecisionWorkflowView {
	const evidenceChecklist = buildEvidenceChecklist(input);
	const decisionState = input.latestDecision
		? "complete"
		: !hasPrimarySource(input.finding, input.evidence) &&
				input.evidence.length === 0
			? "needs_context"
			: "missing";
	const missingInputs: string[] = [];
	if (
		!evidenceChecklist.some((item) => item.kind === "source" && item.available)
	) {
		missingInputs.push("主な証跡");
	}
	if (!input.latestReview) missingInputs.push("LLM レビュー");
	if (!input.latestDecision) missingInputs.push("人間の判断");

	return {
		findingId: input.finding.id,
		latestDecision: input.latestDecision,
		latestReview: input.latestReview,
		decisionState,
		evidenceChecklist,
		reportImpact: mapDecisionToReportBucket(
			input.latestDecision,
			input.reportOptions,
		),
		recommendedReason: recommendReason(input, evidenceChecklist),
		missingInputs,
	};
}
