import type {
	AttackSurfaceItem,
	DiagnosticReport,
	Finding,
	ScanReport,
	ScanReview,
	ScanRun,
	ScanRunSummary,
	SecurityCheckResult,
} from "../../api";

export type DashboardActionKind =
	| "run_scan"
	| "review_findings"
	| "record_decisions"
	| "run_diagnostics"
	| "generate_report"
	| "inspect_zero_findings";

export type DashboardAction = {
	kind: DashboardActionKind;
	label: string;
	priority: "high" | "medium" | "low";
	targetId?: string;
};

export type ProjectDiagnosticDashboard = {
	projectId: string;
	latestScanRun: {
		id: string;
		profile: string;
		status: string;
		createdAt: string;
		completedAt: string | null;
		findingCount: number;
		findingCountKnown: boolean;
	} | null;
	severityCounts: Record<string, number>;
	decisionProgress: {
		totalFindings: number;
		decidedFindings: number;
		undecidedFindings: number;
		needsFix: number;
		falsePositive: number;
		accepted: number;
		deferred: number;
	};
	reviewCoverage: {
		findingReviews: number;
		scanReviews: number;
		reviewMissingFindings: number;
	};
	reportReadiness: {
		scanReports: number;
		diagnosticReports: number;
		ready: boolean;
		blockers: string[];
	};
	diagnosticCoverage: {
		attackSurfaceItems: number;
		securityChecks: number;
		coverageGaps: number;
	};
	nextActions: DashboardAction[];
};

type DashboardFinding = Finding & {
	latestReview?: unknown | null;
};

type BuildProjectDiagnosticDashboardInput = {
	projectId: string;
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	findings: DashboardFinding[];
	reports: ScanReport[];
	scanReviews: ScanReview[];
	diagnosticReports: DiagnosticReport[];
	securityCheckResults: SecurityCheckResult[];
	attackSurfaceItems: AttackSurfaceItem[];
	scanSummary?: ScanRunSummary | null;
};

const severityOrder = ["critical", "high", "medium", "low", "info", "unknown"];
const gapStatuses = new Set(["manual_review", "not_checked", "warn", "fail"]);
const actionOrder: DashboardActionKind[] = [
	"run_scan",
	"record_decisions",
	"inspect_zero_findings",
	"run_diagnostics",
	"generate_report",
	"review_findings",
];
const priorityRank = { high: 0, medium: 1, low: 2 } as const;

export function buildProjectDiagnosticDashboard(
	input: BuildProjectDiagnosticDashboardInput,
): ProjectDiagnosticDashboard {
	const sortedRuns = [...input.scanRuns].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
	const latestRun = sortedRuns[0] ?? null;
	const activeRun =
		sortedRuns.find((run) => run.id === input.selectedScanRunId) ??
		latestRun ??
		null;
	const activeFindings = activeRun
		? input.findings.filter((finding) => finding.scanRunId === activeRun.id)
		: [];
	const activeRunIsLatest = Boolean(
		activeRun && latestRun?.id === activeRun.id,
	);
	const latestFindingCount = latestRun
		? input.findings.filter((finding) => finding.scanRunId === latestRun.id)
				.length
		: 0;

	const severityCounts = Object.fromEntries(
		severityOrder.map((severity) => [severity, 0]),
	) as Record<string, number>;
	for (const finding of activeFindings) {
		severityCounts[finding.severity] =
			(severityCounts[finding.severity] ?? 0) + 1;
	}

	const decisionProgress = activeFindings.reduce(
		(progress, finding) => {
			const decision = finding.latestDecision?.decision;
			if (!decision) return progress;
			progress.decidedFindings += 1;
			if (decision === "needs_fix") progress.needsFix += 1;
			if (decision === "false_positive") progress.falsePositive += 1;
			if (decision === "accepted") progress.accepted += 1;
			if (decision === "deferred") progress.deferred += 1;
			return progress;
		},
		{
			totalFindings: activeFindings.length,
			decidedFindings: 0,
			undecidedFindings: activeFindings.length,
			needsFix: 0,
			falsePositive: 0,
			accepted: 0,
			deferred: 0,
		},
	);
	decisionProgress.undecidedFindings =
		decisionProgress.totalFindings - decisionProgress.decidedFindings;

	const findingReviews =
		input.scanSummary?.totals.reviewedFindingCount ??
		activeFindings.filter((finding) => Boolean(finding.latestReview)).length;
	const reviewMissingFindings = Math.max(
		0,
		activeFindings.length - findingReviews,
	);
	const completedDiagnosticReports = input.diagnosticReports.filter(
		(report) => report.status === "completed",
	);
	const diagnosticCoverage = {
		attackSurfaceItems: input.attackSurfaceItems.length,
		securityChecks: input.securityCheckResults.length,
		coverageGaps: input.securityCheckResults.filter((result) =>
			gapStatuses.has(result.status),
		).length,
	};

	const blockers: string[] = [];
	if (!activeRun) {
		blockers.push("no_scan_selected");
	} else {
		if (activeRun.status !== "completed") blockers.push("scan_not_completed");
		if (decisionProgress.undecidedFindings > 0)
			blockers.push("undecided_findings");
		if (
			activeFindings.length === 0 &&
			completedDiagnosticReports.length === 0
		) {
			blockers.push("missing_diagnostic_summary_for_zero_findings");
		}
	}

	const nextActions: DashboardAction[] = [];
	const addAction = (action: DashboardAction) => {
		if (nextActions.some((item) => item.kind === action.kind)) return;
		nextActions.push(action);
	};
	const firstUndecided = activeFindings.find(
		(finding) => !finding.latestDecision,
	);
	const firstMissingReview =
		activeFindings.find((finding) => !finding.latestReview) ??
		(reviewMissingFindings > 0 ? activeFindings[0] : undefined);

	if (!input.projectId || !activeRun) {
		addAction({
			kind: "run_scan",
			label: "Run the first scan",
			priority: "high",
		});
	} else if (
		latestRun?.status === "failed" ||
		latestRun?.status === "cancelled"
	) {
		addAction({
			kind: "run_scan",
			label: "Run a fresh scan",
			priority: "high",
			targetId: latestRun.id,
		});
	}
	if (firstUndecided) {
		addAction({
			kind: "record_decisions",
			label: "Record finding decisions",
			priority: "high",
			targetId: firstUndecided.id,
		});
	}
	if (
		activeRun?.status === "completed" &&
		activeFindings.length === 0 &&
		completedDiagnosticReports.length === 0
	) {
		addAction({
			kind: "inspect_zero_findings",
			label: "Inspect zero-finding coverage",
			priority: "high",
			targetId: activeRun.id,
		});
	}
	if (
		activeRun?.status === "completed" &&
		(diagnosticCoverage.coverageGaps > 0 ||
			(input.securityCheckResults.length === 0 &&
				input.attackSurfaceItems.length === 0))
	) {
		addAction({
			kind: "run_diagnostics",
			label: "Run diagnostics",
			priority: "medium",
			targetId: activeRun.id,
		});
	}
	if (
		activeRun?.status === "completed" &&
		blockers.length === 0 &&
		!input.reports[0]
	) {
		addAction({
			kind: "generate_report",
			label: "Generate report",
			priority: "medium",
			targetId: activeRun.id,
		});
	}
	if (firstMissingReview) {
		addAction({
			kind: "review_findings",
			label: "Review findings",
			priority: "low",
			targetId: firstMissingReview.id,
		});
	}

	nextActions.sort((a, b) => {
		const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
		if (priorityDelta !== 0) return priorityDelta;
		return actionOrder.indexOf(a.kind) - actionOrder.indexOf(b.kind);
	});

	return {
		projectId: input.projectId,
		latestScanRun: latestRun
			? {
					id: latestRun.id,
					profile: latestRun.profile,
					status: latestRun.status,
					createdAt: latestRun.createdAt,
					completedAt: latestRun.completedAt,
					findingCount: latestFindingCount,
					findingCountKnown: activeRunIsLatest || latestFindingCount > 0,
				}
			: null,
		severityCounts,
		decisionProgress,
		reviewCoverage: {
			findingReviews,
			scanReviews: input.scanReviews.length,
			reviewMissingFindings,
		},
		reportReadiness: {
			scanReports: input.reports.length,
			diagnosticReports: input.diagnosticReports.length,
			ready: blockers.length === 0,
			blockers,
		},
		diagnosticCoverage,
		nextActions,
	};
}
