import { useMemo } from "react";
import type {
	AttackSurfaceItem,
	AutomatedDiagnosticRun,
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
} from "../../../api";
import { buildCoverageSummary } from "../coverage/use-scans-coverage";
import { buildDecisionGradeView } from "../decision-grade-view";
import { buildProjectDiagnosticDashboard } from "../diagnostic-dashboard";
import { buildActionQueue } from "../work-states";
import {
	buildDisplayedFindings,
	buildEvidenceQualityByFindingId,
	buildFindingWorkStates,
	buildRemediationPlansByFindingId,
	buildVerificationByFindingId,
} from "./finding-derived";

type SelectedFindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};

export function useScansDerivedState(params: {
	selectedVerificationDataLoaded: boolean;
	selectedFindingId: string;
	reproductionRuns: ReproductionRun[];
	dynamicRuns: DynamicRun[];
	findings: Finding[];
	selectedFindingDetails: SelectedFindingDetails | null;
	selectedFindingDastEvidence?: DastEvidence[];
	diagnosticReports: DiagnosticReport[];
	automatedDiagnostics?: AutomatedDiagnosticRun[];
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
	baselineFindings: Finding[] | null;
	baselineScanRunId: string | null;
}) {
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
				automatedDiagnostics: params.automatedDiagnostics ?? [],
				selectedCoverageSummary,
				baselineScanRunId: params.baselineScanRunId,
				baselineFindings: params.baselineFindings,
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
			params.automatedDiagnostics,
			selectedCoverageSummary,
			params.baselineScanRunId,
			params.baselineFindings,
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
				automatedDiagnostics: params.automatedDiagnostics ?? [],
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
			params.automatedDiagnostics,
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
