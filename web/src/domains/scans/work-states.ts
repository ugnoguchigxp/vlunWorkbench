import type {
	DiagnosticReport,
	DynamicRun,
	Finding,
	FindingEvidence,
	FindingReview,
	ReproductionRun,
	ScanReport,
	ScanRun,
	ScanRunSummary,
} from "../../api";

export type FindingWorkState =
	| "needs_review"
	| "needs_verification"
	| "blocked_by_evidence"
	| "ready_for_report"
	| "false_positive_recorded"
	| "accepted_risk_recorded";

export type ScanWorkState =
	| "scan_failed"
	| "triage_open"
	| "diagnostics_open"
	| "report_ready"
	| "report_generated"
	| "zero_finding_needs_coverage";

export type ActionQueuePriority = "high" | "medium" | "low";

export type ActionQueueState =
	| "scan_failed"
	| "needs_review"
	| "needs_verification"
	| "blocked_by_evidence"
	| "ready_for_report"
	| "report_generated"
	| "zero_finding_needs_coverage";

export type ActionQueueItem = {
	id: string;
	targetType: "scan" | "finding" | "report" | "diagnostic";
	targetId: string;
	state: ActionQueueState;
	priority: ActionQueuePriority;
	label: string;
	reason: string;
	updatedAt: string | null;
	severity?: Finding["severity"];
	targetSummary?: string;
};

export type FindingWorkStateInput = {
	finding: Finding;
	evidence?: FindingEvidence[];
	latestReview?: Partial<FindingReview> | null;
	reproductionRuns?: ReproductionRun[];
	dynamicRuns?: DynamicRun[];
};

export type ScanWorkStateInput = {
	scanRun: ScanRun;
	findings: Finding[];
	reports?: ScanReport[];
	diagnosticReports?: DiagnosticReport[];
	scanSummary?: ScanRunSummary | null;
	verificationByFindingId?: Map<
		string,
		{
			reproductionRuns?: ReproductionRun[];
			dynamicRuns?: DynamicRun[];
		}
	>;
};

export type BuildActionQueueInput = {
	scanRuns: ScanRun[];
	selectedScanRunId?: string | null;
	findings: Finding[];
	reports?: ScanReport[];
	diagnosticReports?: DiagnosticReport[];
	scanSummary?: ScanRunSummary | null;
	verificationByFindingId?: Map<
		string,
		{
			reproductionRuns?: ReproductionRun[];
			dynamicRuns?: DynamicRun[];
		}
	>;
};

const priorityRank: Record<ActionQueuePriority, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

const severityRank: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

const evidenceKeys = [
	"artifactId",
	"artifactIds",
	"artifactPath",
	"artifactPaths",
	"evidence",
	"evidenceRefs",
	"evidenceRefsJson",
	"sourceArtifactId",
	"sourceSnippet",
	"snippet",
];

const getLatestReview = (
	input: FindingWorkStateInput,
): Partial<FindingReview> | null | undefined =>
	input.latestReview ?? input.finding.latestReview ?? null;

const hasObjectValue = (value: unknown): boolean => {
	if (!value) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return typeof value === "string" ? value.trim().length > 0 : true;
};

const hasUsableLocation = (finding: Finding): boolean => {
	const location = finding.primaryLocation;
	if (!location) return false;
	return (
		(typeof location.path === "string" && location.path.trim().length > 0) ||
		(typeof location.file === "string" && location.file.trim().length > 0) ||
		(typeof location.uri === "string" && location.uri.trim().length > 0)
	);
};

const hasUsableEvidence = (input: FindingWorkStateInput): boolean => {
	if (hasUsableLocation(input.finding)) return true;
	if (
		input.evidence?.some(
			(item) =>
				Boolean(item.artifactId) ||
				hasObjectValue(item.location) ||
				Boolean(item.snippet?.trim()),
		)
	) {
		return true;
	}
	const metadata = input.finding.metadata ?? {};
	return evidenceKeys.some((key) => hasObjectValue(metadata[key]));
};

const hasCompletedVerification = (input: FindingWorkStateInput): boolean => {
	const reproductionDone = input.reproductionRuns?.some(
		(run) =>
			run.status === "completed" &&
			(run.outcome === "reproduced" || run.outcome === "not_reproduced"),
	);
	const dynamicDone = input.dynamicRuns?.some(
		(run) =>
			run.status === "completed" &&
			(run.outcome === "passed" || run.outcome === "failed"),
	);
	return Boolean(reproductionDone || dynamicDone);
};

const needsVerificationSignal = (input: FindingWorkStateInput): boolean => {
	if (hasCompletedVerification(input)) return false;
	const decision = input.finding.latestDecision;
	if (
		decision?.decision === "deferred" ||
		decision?.reason === "insufficient_evidence" ||
		decision?.reason === "environment_specific"
	) {
		return true;
	}
	const review = getLatestReview(input);
	if (review?.status !== "completed") return false;
	return (
		review.evidenceStrength?.level === "weak" ||
		review.evidenceStrength?.level === "unknown" ||
		review.falsePositiveAssessment?.level === "unknown" ||
		review.confidenceAdjustment === "decrease"
	);
};

export function deriveFindingWorkState(
	input: FindingWorkStateInput,
): FindingWorkState {
	const decision = input.finding.latestDecision;
	if (decision?.decision === "false_positive") return "false_positive_recorded";
	if (decision?.decision === "accepted") return "accepted_risk_recorded";
	if (!hasUsableEvidence(input)) return "blocked_by_evidence";

	const review = getLatestReview(input);
	if (review?.status !== "completed") return "needs_review";
	if (needsVerificationSignal(input)) return "needs_verification";
	return "ready_for_report";
}

export function deriveScanWorkState(input: ScanWorkStateInput): ScanWorkState {
	if (input.scanRun.status === "failed" || input.scanRun.status === "cancelled")
		return "scan_failed";

	const findingCount =
		input.scanSummary?.totals.findingCount ?? input.findings.length;
	const completedDiagnosticReports = input.diagnosticReports?.filter(
		(report) => report.status === "completed",
	);
	if (
		input.scanRun.status === "completed" &&
		findingCount === 0 &&
		!completedDiagnosticReports?.length
	) {
		return "zero_finding_needs_coverage";
	}

	const completedReports = input.reports?.filter(
		(report) => report.status === "completed",
	);
	if (completedReports?.length) return "report_generated";

	const findingStates = input.findings.map((finding) => {
		const verification = input.verificationByFindingId?.get(finding.id);
		return deriveFindingWorkState({
			finding,
			reproductionRuns: verification?.reproductionRuns,
			dynamicRuns: verification?.dynamicRuns,
		});
	});
	if (
		findingStates.some(
			(state) => state === "blocked_by_evidence" || state === "needs_review",
		)
	) {
		return "triage_open";
	}
	if (input.scanRun.status === "completed") return "report_ready";
	return "diagnostics_open";
}

const priorityForFinding = (_finding: Finding, state: FindingWorkState) => {
	if (state === "blocked_by_evidence") return "high";
	if (state === "needs_review" || state === "needs_verification")
		return "medium";
	return "low";
};

const findingReason = (finding: Finding, state: FindingWorkState): string => {
	if (state === "blocked_by_evidence")
		return "利用可能な検出位置またはアーティファクト証跡が不足しています。";
	if (state === "needs_review")
		return "この finding は、次の LLM に渡すリスク文脈がまだ生成されていません。";
	if (state === "needs_verification")
		return "保存済み証跡を LLM handoff に渡す前に、再現確認または動的検証で信頼度を上げられます。";
	return `${finding.severity} の finding はレポートに含められる状態です。`;
};

const stateLabels: Record<ActionQueueState, string> = {
	scan_failed: "スキャン失敗",
	needs_review: "LLMリスク文脈待ち",
	needs_verification: "検証推奨",
	blocked_by_evidence: "証跡不足",
	ready_for_report: "レポート作成可能",
	report_generated: "レポート作成済み",
	zero_finding_needs_coverage: "カバレッジ確認待ち",
};

const stateLabel = (state: ActionQueueState): string => stateLabels[state];

function findingQueueItem(
	finding: Finding,
	state: Extract<
		FindingWorkState,
		"blocked_by_evidence" | "needs_review" | "needs_verification"
	>,
): ActionQueueItem {
	return {
		id: `finding:${finding.id}:${state}`,
		targetType: "finding",
		targetId: finding.id,
		state,
		priority: priorityForFinding(finding, state),
		label:
			state === "needs_review"
				? `LLMリスク文脈未生成: ${finding.title}`
				: state === "needs_verification"
					? `検証を確認: ${finding.title}`
					: `証跡不足: ${finding.title}`,
		reason: findingReason(finding, state),
		updatedAt: finding.updatedAt,
		severity: finding.severity,
		targetSummary: `${finding.sourceTool} / ${finding.ruleId}`,
	};
}

export function buildActionQueue(
	input: BuildActionQueueInput,
): ActionQueueItem[] {
	const selectedScanRun =
		input.scanRuns.find((run) => run.id === input.selectedScanRunId) ??
		input.scanRuns[0] ??
		null;
	const items: ActionQueueItem[] = [];

	for (const scanRun of input.scanRuns) {
		if (scanRun.status !== "failed" && scanRun.status !== "cancelled") continue;
		items.push({
			id: `scan:${scanRun.id}:scan_failed`,
			targetType: "scan",
			targetId: scanRun.id,
			state: "scan_failed",
			priority: "high",
			label: `失敗したスキャンを確認: ${scanRun.profile}`,
			reason: "スキャンが正常に完了していません。",
			updatedAt: scanRun.updatedAt,
			targetSummary: scanRun.profile,
		});
	}

	for (const finding of input.findings) {
		const verification = input.verificationByFindingId?.get(finding.id);
		const state = deriveFindingWorkState({
			finding,
			reproductionRuns: verification?.reproductionRuns,
			dynamicRuns: verification?.dynamicRuns,
		});
		if (
			state === "blocked_by_evidence" ||
			state === "needs_review" ||
			state === "needs_verification"
		) {
			items.push(findingQueueItem(finding, state));
		}
	}

	if (selectedScanRun) {
		const scanState = deriveScanWorkState({
			scanRun: selectedScanRun,
			findings: input.findings.filter(
				(finding) => finding.scanRunId === selectedScanRun.id,
			),
			reports: input.reports,
			diagnosticReports: input.diagnosticReports,
			scanSummary: input.scanSummary,
			verificationByFindingId: input.verificationByFindingId,
		});
		if (scanState === "zero_finding_needs_coverage") {
			items.push({
				id: `diagnostic:${selectedScanRun.id}:zero_finding_needs_coverage`,
				targetType: "diagnostic",
				targetId: selectedScanRun.id,
				state: "zero_finding_needs_coverage",
				priority: "medium",
				label: `カバレッジ要約を追加: ${selectedScanRun.profile}`,
				reason:
					"スキャンは finding 0 件で完了していますが、完了済みの診断レポートがありません。",
				updatedAt: selectedScanRun.updatedAt,
				targetSummary: selectedScanRun.profile,
			});
		} else if (scanState === "report_ready") {
			items.push({
				id: `report:${selectedScanRun.id}:ready_for_report`,
				targetType: "report",
				targetId: selectedScanRun.id,
				state: "ready_for_report",
				priority: "low",
				label: `レポートを作成: ${selectedScanRun.profile}`,
				reason:
					"LLM handoff、証跡、カバレッジの文脈が揃っていますが、完了済みレポートがまだ保存されていません。",
				updatedAt: selectedScanRun.updatedAt,
				targetSummary: selectedScanRun.profile,
			});
		} else if (scanState === "report_generated") {
			const latestReport = input.reports?.find(
				(report) => report.status === "completed",
			);
			items.push({
				id: `report:${selectedScanRun.id}:report_generated`,
				targetType: "report",
				targetId: selectedScanRun.id,
				state: "report_generated",
				priority: "low",
				label: `作成済みレポートを確認: ${selectedScanRun.profile}`,
				reason: "このスキャンには完了済みレポートがあります。",
				updatedAt: latestReport?.updatedAt ?? selectedScanRun.updatedAt,
				targetSummary: latestReport?.title ?? selectedScanRun.profile,
			});
		}
	}

	return sortActionQueue(items);
}

export function sortActionQueue(items: ActionQueueItem[]): ActionQueueItem[] {
	return [...items].sort((a, b) => {
		const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
		if (priorityDelta !== 0) return priorityDelta;
		const severityDelta =
			severityRank[a.severity ?? "unknown"] -
			severityRank[b.severity ?? "unknown"];
		if (severityDelta !== 0) return severityDelta;
		const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
		const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
		if (aTime !== bTime) return bTime - aTime;
		return a.label.localeCompare(b.label);
	});
}

export const actionQueueStateLabel = stateLabel;
