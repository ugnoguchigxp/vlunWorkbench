import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	AttackSurfaceItem,
	DastEvidence,
	DiagnosticReport,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingGroup,
	FindingReview,
	Project,
	ReproductionRun,
	ScanReport,
	ScanReview,
	ScanRun,
	ScanRunSummary,
	SecurityCheckResult,
} from "../../api";
import { fetchScanFindings } from "../../api";
import { buildCoverageSummary } from "./coverage-summary";
import { buildDecisionGradeView } from "./decision-grade-view";
import {
	buildProjectDiagnosticDashboard,
	type DashboardAction,
} from "./diagnostic-dashboard";
import { buildEvidenceQuality } from "./evidence-quality";
import { buildRemediationPlanView } from "./remediation-plan";
import {
	type ActionQueueItem,
	buildActionQueue,
	deriveFindingWorkState,
	type FindingWorkState,
} from "./work-states";

export type VerificationByFindingId = Map<
	string,
	{ reproductionRuns?: ReproductionRun[]; dynamicRuns?: DynamicRun[] }
>;

type SelectedFindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};

const workStateRank: Record<FindingWorkState, number> = {
	blocked_by_evidence: 0,
	needs_review: 1,
	needs_verification: 2,
	ready_for_report: 3,
	false_positive_recorded: 4,
	accepted_risk_recorded: 5,
};

const severityRank: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export function buildVerificationByFindingId(params: {
	selectedVerificationDataLoaded: boolean;
	selectedFindingId: string;
	reproductionRuns: ReproductionRun[];
	dynamicRuns: DynamicRun[];
}): VerificationByFindingId {
	const map: VerificationByFindingId = new Map();
	if (params.selectedVerificationDataLoaded && params.selectedFindingId) {
		map.set(params.selectedFindingId, {
			reproductionRuns: params.reproductionRuns,
			dynamicRuns: params.dynamicRuns,
		});
	}
	return map;
}

export function buildFindingWorkStates(
	findings: Finding[],
	verificationByFindingId: VerificationByFindingId,
): Map<string, FindingWorkState> {
	const states = new Map<string, FindingWorkState>();
	for (const finding of findings) {
		const verification = verificationByFindingId.get(finding.id);
		states.set(
			finding.id,
			deriveFindingWorkState({
				finding,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
			}),
		);
	}
	return states;
}

export function buildEvidenceQualityByFindingId(params: {
	findings: Finding[];
	selectedFindingId: string;
	selectedFindingDetails: SelectedFindingDetails | null;
	verificationByFindingId: VerificationByFindingId;
	selectedFindingDastEvidence?: DastEvidence[];
	diagnosticReports: DiagnosticReport[];
}): Map<string, ReturnType<typeof buildEvidenceQuality>> {
	const map = new Map<string, ReturnType<typeof buildEvidenceQuality>>();
	for (const finding of params.findings) {
		const isSelected = finding.id === params.selectedFindingId;
		const verification = params.verificationByFindingId.get(finding.id);
		const details =
			isSelected && params.selectedFindingDetails?.finding.id === finding.id
				? params.selectedFindingDetails
				: null;
		map.set(
			finding.id,
			buildEvidenceQuality({
				finding: details?.finding ?? finding,
				evidence: details?.evidence,
				latestReview: details?.latestReview ?? finding.latestReview,
				latestDecision: details?.latestDecision ?? finding.latestDecision,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
				dastEvidence: isSelected
					? params.selectedFindingDastEvidence
					: undefined,
				diagnosticReports: params.diagnosticReports,
				dataCompleteness: {
					hasFindingDetails: Boolean(details),
					hasVerificationData: Boolean(
						verification?.reproductionRuns?.length ||
							verification?.dynamicRuns?.length,
					),
					hasDastEvidenceLoaded:
						isSelected && (params.selectedFindingDastEvidence?.length ?? 0) > 0,
				},
			}),
		);
	}
	return map;
}

export function buildRemediationPlansByFindingId(params: {
	findings: Finding[];
	selectedFindingId: string;
	selectedFindingDetails: SelectedFindingDetails | null;
	verificationByFindingId: VerificationByFindingId;
}): Map<string, ReturnType<typeof buildRemediationPlanView>> {
	const map = new Map<string, ReturnType<typeof buildRemediationPlanView>>();
	for (const finding of params.findings) {
		const isSelected = finding.id === params.selectedFindingId;
		const verification = params.verificationByFindingId.get(finding.id);
		const details =
			isSelected && params.selectedFindingDetails?.finding.id === finding.id
				? params.selectedFindingDetails
				: null;
		map.set(
			finding.id,
			buildRemediationPlanView({
				finding: details?.finding ?? finding,
				latestDecision: details?.latestDecision ?? finding.latestDecision,
				latestReview: details?.latestReview ?? finding.latestReview,
				reproductionRuns: verification?.reproductionRuns,
				dynamicRuns: verification?.dynamicRuns,
			}),
		);
	}
	return map;
}

export function buildDisplayedFindings(params: {
	findings: Finding[];
	findingsViewMode: "list" | "grouped";
	selectedGroupId: string;
	scanGroups: FindingGroup[];
	findingWorkStatesById: Map<string, FindingWorkState>;
}): Finding[] {
	const base =
		params.findingsViewMode === "grouped" && params.selectedGroupId
			? params.findings.filter((item) =>
					params.scanGroups
						.find((group) => group.id === params.selectedGroupId)
						?.findingIds.includes(item.id),
				)
			: params.findings;
	if (params.findingsViewMode === "grouped") return base;
	return [...base].sort((left, right) => {
		const stateDelta =
			workStateRank[
				params.findingWorkStatesById.get(left.id) ?? "ready_for_report"
			] -
			workStateRank[
				params.findingWorkStatesById.get(right.id) ?? "ready_for_report"
			];
		if (stateDelta !== 0) return stateDelta;
		const severityDelta =
			(severityRank[left.severity] ?? severityRank.unknown) -
			(severityRank[right.severity] ?? severityRank.unknown);
		if (severityDelta !== 0) return severityDelta;
		const leftTime = new Date(left.updatedAt).getTime();
		const rightTime = new Date(right.updatedAt).getTime();
		if (leftTime !== rightTime) return rightTime - leftTime;
		return left.title.localeCompare(right.title);
	});
}

export function selectBaselineScanRun(
	scanRuns: ScanRun[],
	selectedScanRun: ScanRun | null,
): ScanRun | null {
	if (!selectedScanRun) return null;
	return (
		scanRuns
			.filter(
				(run) =>
					run.id !== selectedScanRun.id &&
					run.profile === selectedScanRun.profile &&
					new Date(run.createdAt).getTime() <
						new Date(selectedScanRun.createdAt).getTime(),
			)
			.sort(
				(left, right) =>
					new Date(right.createdAt).getTime() -
					new Date(left.createdAt).getTime(),
			)[0] ?? null
	);
}

export function useScansDerivedState(params: {
	selectedVerificationDataLoaded: boolean;
	selectedFindingId: string;
	reproductionRuns: ReproductionRun[];
	dynamicRuns: DynamicRun[];
	findings: Finding[];
	selectedFindingDetails: SelectedFindingDetails | null;
	selectedFindingDastEvidence?: DastEvidence[];
	diagnosticReports: DiagnosticReport[];
	findingsViewMode: "list" | "grouped";
	selectedGroupId: string;
	scanGroups: FindingGroup[];
	projects: Project[];
	selectedProjectId: string;
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	attackSurfaceItems: AttackSurfaceItem[];
	securityCheckResults: SecurityCheckResult[];
	scanSummary: ScanRunSummary | null;
	scanReviews: ScanReview[];
	reports: ScanReport[];
	actionQueueFilter:
		| "active"
		| "all"
		| "needs_review"
		| "needs_verification"
		| "ready_for_report"
		| "blocked_by_evidence";
}) {
	const [baselineFindings, setBaselineFindings] = useState<Finding[] | null>(
		null,
	);
	const [baselineScanRunId, setBaselineScanRunId] = useState<string | null>(
		null,
	);
	const verificationByFindingId = useMemo(
		() =>
			buildVerificationByFindingId({
				selectedVerificationDataLoaded: params.selectedVerificationDataLoaded,
				selectedFindingId: params.selectedFindingId,
				reproductionRuns: params.reproductionRuns,
				dynamicRuns: params.dynamicRuns,
			}),
		[
			params.selectedVerificationDataLoaded,
			params.selectedFindingId,
			params.reproductionRuns,
			params.dynamicRuns,
		],
	);
	const findingWorkStatesById = useMemo(
		() => buildFindingWorkStates(params.findings, verificationByFindingId),
		[params.findings, verificationByFindingId],
	);
	const evidenceQualityByFindingId = useMemo(
		() =>
			buildEvidenceQualityByFindingId({
				findings: params.findings,
				selectedFindingId: params.selectedFindingId,
				selectedFindingDetails: params.selectedFindingDetails,
				verificationByFindingId,
				selectedFindingDastEvidence: params.selectedFindingDastEvidence,
				diagnosticReports: params.diagnosticReports,
			}),
		[
			params.findings,
			params.selectedFindingId,
			params.selectedFindingDetails,
			params.selectedFindingDastEvidence,
			params.diagnosticReports,
			verificationByFindingId,
		],
	);
	const remediationPlanByFindingId = useMemo(
		() =>
			buildRemediationPlansByFindingId({
				findings: params.findings,
				selectedFindingId: params.selectedFindingId,
				selectedFindingDetails: params.selectedFindingDetails,
				verificationByFindingId,
			}),
		[
			params.findings,
			params.selectedFindingId,
			params.selectedFindingDetails,
			verificationByFindingId,
		],
	);
	const selectedEvidenceQuality = params.selectedFindingId
		? (evidenceQualityByFindingId.get(params.selectedFindingId) ?? null)
		: null;
	const selectedRemediationPlan = params.selectedFindingId
		? (remediationPlanByFindingId.get(params.selectedFindingId) ?? null)
		: null;
	const displayedFindings = useMemo(
		() =>
			buildDisplayedFindings({
				findings: params.findings,
				findingsViewMode: params.findingsViewMode,
				selectedGroupId: params.selectedGroupId,
				scanGroups: params.scanGroups,
				findingWorkStatesById,
			}),
		[
			params.findings,
			params.findingsViewMode,
			params.selectedGroupId,
			params.scanGroups,
			findingWorkStatesById,
		],
	);
	const selectedProject =
		params.projects.find(
			(project) => project.id === params.selectedProjectId,
		) ?? null;
	const selectedScanRun =
		params.scanRuns.find((run) => run.id === params.selectedScanRunId) ?? null;
	const baselineScanRun = useMemo(
		() => selectBaselineScanRun(params.scanRuns, selectedScanRun),
		[params.scanRuns, selectedScanRun],
	);
	useEffect(() => {
		let cancelled = false;
		setBaselineFindings(null);
		setBaselineScanRunId(baselineScanRun?.id ?? null);
		if (!baselineScanRun) return;
		void fetchScanFindings(baselineScanRun.id)
			.then((items) => {
				if (!cancelled) setBaselineFindings(items);
			})
			.catch(() => {
				if (!cancelled) setBaselineFindings(null);
			});
		return () => {
			cancelled = true;
		};
	}, [baselineScanRun]);
	const selectedCoverageSummary = useMemo(
		() =>
			buildCoverageSummary({
				scanRun: selectedScanRun,
				findings: params.findings,
				attackSurfaceItems: params.attackSurfaceItems,
				securityCheckResults: params.securityCheckResults,
				diagnosticReports: params.diagnosticReports,
				scanSummary: params.scanSummary,
			}),
		[
			selectedScanRun,
			params.findings,
			params.attackSurfaceItems,
			params.securityCheckResults,
			params.diagnosticReports,
			params.scanSummary,
		],
	);
	const decisionGradeView = useMemo(
		() =>
			buildDecisionGradeView({
				selectedScanRunId: params.selectedScanRunId,
				selectedScanRun,
				findings: params.findings,
				scanReviews: params.scanReviews,
				evidenceQualityByFindingId,
				remediationPlanByFindingId,
				reports: params.reports,
				diagnosticReports: params.diagnosticReports,
				selectedCoverageSummary,
				baselineScanRunId,
				baselineFindings,
			}),
		[
			params.selectedScanRunId,
			selectedScanRun,
			params.findings,
			params.scanReviews,
			evidenceQualityByFindingId,
			remediationPlanByFindingId,
			params.reports,
			params.diagnosticReports,
			selectedCoverageSummary,
			baselineScanRunId,
			baselineFindings,
		],
	);
	const diagnosticDashboard = useMemo(
		() =>
			buildProjectDiagnosticDashboard({
				projectId: params.selectedProjectId,
				scanRuns: params.scanRuns,
				selectedScanRunId: params.selectedScanRunId,
				findings: params.findings,
				reports: params.reports,
				scanReviews: params.scanReviews,
				diagnosticReports: params.diagnosticReports,
				securityCheckResults: params.securityCheckResults,
				attackSurfaceItems: params.attackSurfaceItems,
				scanSummary: params.scanSummary,
			}),
		[
			params.selectedProjectId,
			params.scanRuns,
			params.selectedScanRunId,
			params.findings,
			params.reports,
			params.scanReviews,
			params.diagnosticReports,
			params.securityCheckResults,
			params.attackSurfaceItems,
			params.scanSummary,
		],
	);
	const actionQueueItems = useMemo(
		() =>
			buildActionQueue({
				scanRuns: params.scanRuns,
				selectedScanRunId: params.selectedScanRunId,
				findings: params.findings,
				reports: params.reports,
				diagnosticReports: params.diagnosticReports,
				scanSummary: params.scanSummary,
				verificationByFindingId,
			}),
		[
			params.scanRuns,
			params.selectedScanRunId,
			params.findings,
			params.reports,
			params.diagnosticReports,
			params.scanSummary,
			verificationByFindingId,
		],
	);
	const filteredActionQueueItems = useMemo(
		() =>
			actionQueueItems.filter((item) => {
				if (params.actionQueueFilter === "all") return true;
				if (params.actionQueueFilter === "active") {
					return item.state !== "report_generated";
				}
				return item.state === params.actionQueueFilter;
			}),
		[params.actionQueueFilter, actionQueueItems],
	);
	return {
		selectedProject,
		selectedScanRun,
		selectedCoverageSummary,
		...decisionGradeView,
		diagnosticDashboard,
		actionQueueItems,
		filteredActionQueueItems,
		findingWorkStatesById,
		evidenceQualityByFindingId,
		remediationPlanByFindingId,
		selectedEvidenceQuality,
		selectedRemediationPlan,
		displayedFindings,
	};
}

type ScanListTab = "runs" | "findings";
type ScanDetailTab = "review" | "verification" | "report";

export function buildScansNavigationHandlers(params: {
	findings: Finding[];
	selectedScanRunId: string;
	workflowCompletion: ReturnType<
		typeof buildDecisionGradeView
	>["workflowCompletion"];
	selectedFindingIdRef: RefObject<string>;
	setSelectedFindingId: Dispatch<SetStateAction<string>>;
	setSelectedFindingDetails: Dispatch<
		SetStateAction<SelectedFindingDetails | null>
	>;
	setReviewError: Dispatch<SetStateAction<string | null>>;
	setScanListTab: Dispatch<SetStateAction<ScanListTab>>;
	setScanDetailTab: Dispatch<SetStateAction<ScanDetailTab>>;
	handleSelectScanRun: (scanRunId: string) => void;
	handleSelectFinding: (findingId: string) => void;
	handleTriggerScanReview: (scanRunId?: string) => Promise<void>;
	handleGenerateReport: (
		mode: "deterministic",
		scanRunId?: string,
	) => Promise<void>;
	runDiagnosticsForScan: (scanRunId: string) => Promise<void>;
}) {
	const handleActionQueueItem = (item: ActionQueueItem) => {
		if (item.targetType === "finding") {
			const targetFinding = params.findings.find(
				(finding) => finding.id === item.targetId,
			);
			if (
				targetFinding &&
				targetFinding.scanRunId !== params.selectedScanRunId
			) {
				params.handleSelectScanRun(targetFinding.scanRunId);
			}
			params.setScanListTab("findings");
			params.handleSelectFinding(item.targetId);
			params.setScanDetailTab(
				item.state === "needs_verification" ? "verification" : "review",
			);
			return;
		}
		if (item.targetType === "scan") {
			params.handleSelectScanRun(item.targetId);
			params.setScanListTab("runs");
			return;
		}
		if (item.targetType === "report") {
			if (item.targetId !== params.selectedScanRunId) {
				params.handleSelectScanRun(item.targetId);
			}
			params.setScanDetailTab("report");
			return;
		}
		if (item.targetType === "diagnostic") {
			if (item.targetId !== params.selectedScanRunId) {
				params.handleSelectScanRun(item.targetId);
			}
			params.setScanListTab("runs");
			params.setScanDetailTab("review");
		}
	};

	const handleWorkflowNextAction = () => {
		const action = params.workflowCompletion.nextBestAction;
		if (!action) return;
		if (
			action.action === "review_findings" ||
			action.action === "run_verification" ||
			action.action === "create_remediation_plan"
		) {
			const targetFinding =
				params.findings.find((finding) => finding.id === action.targetId) ??
				params.findings[0];
			if (targetFinding) {
				params.setScanListTab("findings");
				params.handleSelectFinding(targetFinding.id);
				params.setScanDetailTab(
					action.action === "run_verification" ? "verification" : "review",
				);
			}
			return;
		}
		if (action.action === "create_improvement_request") {
			void params.handleTriggerScanReview(action.targetId);
			return;
		}
		if (action.action === "generate_report") {
			void params.handleGenerateReport("deterministic", action.targetId);
			return;
		}
		if (action.action === "inspect_coverage") {
			params.setScanListTab("runs");
			params.setScanDetailTab("review");
		}
	};

	const handleCloseFinding = () => {
		params.selectedFindingIdRef.current = "";
		params.setSelectedFindingId("");
		params.setSelectedFindingDetails(null);
		params.setReviewError(null);
		params.setScanDetailTab("review");
	};

	const handleDashboardAction = (action: DashboardAction) => {
		if (action.kind === "run_scan") {
			params.setScanListTab("runs");
			return;
		}
		if (action.kind === "create_improvement_request") {
			if (action.targetId) params.handleSelectScanRun(action.targetId);
			void params.handleTriggerScanReview(action.targetId);
			return;
		}
		if (action.kind === "review_findings") {
			params.setScanListTab("findings");
			const targetFinding =
				params.findings.find((finding) => finding.id === action.targetId) ??
				params.findings[0];
			if (targetFinding) params.handleSelectFinding(targetFinding.id);
			return;
		}
		if (action.kind === "inspect_zero_findings") {
			if (action.targetId) params.handleSelectScanRun(action.targetId);
			params.setScanDetailTab("review");
			return;
		}
		if (action.kind === "run_diagnostics") {
			const targetScanRunId = action.targetId ?? params.selectedScanRunId;
			if (targetScanRunId && targetScanRunId !== params.selectedScanRunId) {
				params.handleSelectScanRun(targetScanRunId);
			}
			if (targetScanRunId) {
				void params.runDiagnosticsForScan(targetScanRunId);
			}
			return;
		}
		if (action.kind === "generate_report") {
			const targetScanRunId = action.targetId ?? params.selectedScanRunId;
			if (targetScanRunId && targetScanRunId !== params.selectedScanRunId) {
				params.handleSelectScanRun(targetScanRunId);
			}
			void params.handleGenerateReport("deterministic", targetScanRunId);
		}
	};

	return {
		handleActionQueueItem,
		handleWorkflowNextAction,
		handleCloseFinding,
		handleDashboardAction,
	};
}
