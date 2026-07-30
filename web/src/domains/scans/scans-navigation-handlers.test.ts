import type { RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardAction } from "./diagnostic-dashboard";
import { buildScansNavigationHandlers } from "./scans-navigation-handlers";
import type { ActionQueueItem } from "./work-states";
import type { WorkflowCompletion } from "./workflow-completion";

type HandlerParams = Parameters<typeof buildScansNavigationHandlers>[0];
type NextAction = NonNullable<WorkflowCompletion["nextBestAction"]>;

const finding = (id: string, scanRunId: string) =>
	({ id, scanRunId }) as HandlerParams["findings"][number];

const workflow = (
	nextBestAction: WorkflowCompletion["nextBestAction"] = null,
) =>
	({
		scanRunId: "scan-selected",
		stage: "report_ready",
		percent: 75,
		checklist: [],
		nextBestAction,
	}) as HandlerParams["workflowCompletion"];

function setup(options?: {
	nextBestAction?: WorkflowCompletion["nextBestAction"];
	findings?: HandlerParams["findings"];
	selectedScanRunId?: string;
}) {
	const params: HandlerParams = {
		findings:
			options?.findings ??
			[finding("finding-other", "scan-other"), finding("finding-selected", "scan-selected")],
		selectedScanRunId: options?.selectedScanRunId ?? "scan-selected",
		workflowCompletion: workflow(options?.nextBestAction),
		selectedFindingIdRef: { current: "finding-selected" } as RefObject<string>,
		setSelectedFindingId: vi.fn(),
		setSelectedFindingDetails: vi.fn(),
		setReviewError: vi.fn(),
		setScanListTab: vi.fn(),
		setScanDetailTab: vi.fn(),
		handleSelectScanRun: vi.fn(),
		handleSelectFinding: vi.fn(),
		handleTriggerScanReview: vi.fn(async () => {}),
		handleGenerateReport: vi.fn(async () => {}),
		handleRetryAutomatedDiagnostic: vi.fn(async () => {}),
		runDiagnosticsForScan: vi.fn(async () => {}),
	};
	return {
		params,
		...buildScansNavigationHandlers(params),
	};
}

const queueItem = (
	targetType: ActionQueueItem["targetType"],
	targetId: string,
	state: ActionQueueItem["state"] = "needs_review",
): ActionQueueItem => ({
	id: `${targetType}:${targetId}`,
	targetType,
	targetId,
	state,
	priority: "high",
	label: "test",
	reason: "test",
	updatedAt: null,
});

const dashboardAction = (
	kind: DashboardAction["kind"],
	targetId?: string,
): DashboardAction => ({
	kind,
	targetId,
	label: "test",
	priority: "high",
});

const nextAction = (
	action: NextAction["action"],
	targetId?: string,
): NextAction => ({
	action,
	targetId,
	label: "test",
});

describe("buildScansNavigationHandlers", () => {
	it("navigates every action queue target without requiring a human decision", () => {
		const findingTarget = setup();
		findingTarget.handleActionQueueItem(
			queueItem("finding", "finding-other", "needs_verification"),
		);
		expect(findingTarget.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(findingTarget.params.setScanListTab).toHaveBeenCalledWith("findings");
		expect(findingTarget.params.handleSelectFinding).toHaveBeenCalledWith(
			"finding-other",
		);
		expect(findingTarget.params.setScanDetailTab).toHaveBeenCalledWith(
			"verification",
		);

		const scanTarget = setup();
		scanTarget.handleActionQueueItem(queueItem("scan", "scan-other"));
		expect(scanTarget.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(scanTarget.params.setScanListTab).toHaveBeenCalledWith("runs");

		const reportTarget = setup();
		reportTarget.handleActionQueueItem(queueItem("report", "scan-other"));
		expect(reportTarget.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(reportTarget.params.setScanDetailTab).toHaveBeenCalledWith("report");

		const diagnosticTarget = setup();
		diagnosticTarget.handleActionQueueItem(
			queueItem("diagnostic", "scan-other"),
		);
		expect(diagnosticTarget.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(diagnosticTarget.params.setScanListTab).toHaveBeenCalledWith("runs");
		expect(diagnosticTarget.params.setScanDetailTab).toHaveBeenCalledWith(
			"review",
		);
	});

	it("routes finding workflow actions and uses the first finding as a safe fallback", () => {
		const review = setup({
			nextBestAction: nextAction("review_findings", "finding-selected"),
		});
		review.handleWorkflowNextAction();
		expect(review.params.handleSelectFinding).toHaveBeenCalledWith(
			"finding-selected",
		);
		expect(review.params.setScanDetailTab).toHaveBeenCalledWith("review");

		const verification = setup({
			nextBestAction: nextAction("run_verification", "missing-finding"),
		});
		verification.handleWorkflowNextAction();
		expect(verification.params.handleSelectFinding).toHaveBeenCalledWith(
			"finding-other",
		);
		expect(verification.params.setScanDetailTab).toHaveBeenCalledWith(
			"verification",
		);

		const remediation = setup({
			nextBestAction: nextAction(
				"create_remediation_plan",
				"finding-selected",
			),
		});
		remediation.handleWorkflowNextAction();
		expect(remediation.params.handleSelectFinding).toHaveBeenCalledWith(
			"finding-selected",
		);
		expect(remediation.params.setScanDetailTab).toHaveBeenCalledWith("review");
	});

	it("executes automated workflow actions and leaves an empty workflow idle", () => {
		const improvement = setup({
			nextBestAction: nextAction(
				"create_improvement_request",
				"scan-other",
			),
		});
		improvement.handleWorkflowNextAction();
		expect(improvement.params.handleTriggerScanReview).toHaveBeenCalledWith(
			"scan-other",
		);

		const report = setup({
			nextBestAction: nextAction("generate_report", "scan-other"),
		});
		report.handleWorkflowNextAction();
		expect(report.params.handleGenerateReport).toHaveBeenCalledWith(
			"deterministic",
			"scan-other",
		);

		const retry = setup({
			nextBestAction: nextAction("retry_diagnostic", "scan-other"),
		});
		retry.handleWorkflowNextAction();
		expect(
			retry.params.handleRetryAutomatedDiagnostic,
		).toHaveBeenCalledWith("scan-other");

		const coverage = setup({
			nextBestAction: nextAction("inspect_coverage"),
		});
		coverage.handleWorkflowNextAction();
		expect(coverage.params.setScanListTab).toHaveBeenCalledWith("runs");
		expect(coverage.params.setScanDetailTab).toHaveBeenCalledWith("review");

		const idle = setup();
		idle.handleWorkflowNextAction();
		expect(idle.params.handleSelectFinding).not.toHaveBeenCalled();
		expect(idle.params.handleGenerateReport).not.toHaveBeenCalled();
	});

	it("clears selected finding state", () => {
		const handlers = setup();
		handlers.handleCloseFinding();
		expect(handlers.params.selectedFindingIdRef.current).toBe("");
		expect(handlers.params.setSelectedFindingId).toHaveBeenCalledWith("");
		expect(handlers.params.setSelectedFindingDetails).toHaveBeenCalledWith(null);
		expect(handlers.params.setReviewError).toHaveBeenCalledWith(null);
		expect(handlers.params.setScanDetailTab).toHaveBeenCalledWith("review");
	});

	it("executes dashboard actions with explicit and selected scan targets", () => {
		const runScan = setup();
		runScan.handleDashboardAction(dashboardAction("run_scan"));
		expect(runScan.params.setScanListTab).toHaveBeenCalledWith("runs");

		const improvement = setup();
		improvement.handleDashboardAction(
			dashboardAction("create_improvement_request", "scan-other"),
		);
		expect(improvement.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(improvement.params.handleTriggerScanReview).toHaveBeenCalledWith(
			"scan-other",
		);

		const review = setup();
		review.handleDashboardAction(
			dashboardAction("review_findings", "finding-selected"),
		);
		expect(review.params.setScanListTab).toHaveBeenCalledWith("findings");
		expect(review.params.handleSelectFinding).toHaveBeenCalledWith(
			"finding-selected",
		);

		const inspect = setup();
		inspect.handleDashboardAction(
			dashboardAction("inspect_zero_findings", "scan-other"),
		);
		expect(inspect.params.handleSelectScanRun).toHaveBeenCalledWith("scan-other");
		expect(inspect.params.setScanDetailTab).toHaveBeenCalledWith("review");

		const diagnostics = setup();
		diagnostics.handleDashboardAction(
			dashboardAction("run_diagnostics", "scan-other"),
		);
		expect(diagnostics.params.handleSelectScanRun).toHaveBeenCalledWith(
			"scan-other",
		);
		expect(diagnostics.params.runDiagnosticsForScan).toHaveBeenCalledWith(
			"scan-other",
		);

		const selectedDiagnostics = setup();
		selectedDiagnostics.handleDashboardAction(
			dashboardAction("run_diagnostics"),
		);
		expect(
			selectedDiagnostics.params.runDiagnosticsForScan,
		).toHaveBeenCalledWith("scan-selected");

		const retry = setup();
		retry.handleDashboardAction(
			dashboardAction("retry_diagnostic", "scan-other"),
		);
		expect(
			retry.params.handleRetryAutomatedDiagnostic,
		).toHaveBeenCalledWith("scan-other");

		const report = setup();
		report.handleDashboardAction(
			dashboardAction("generate_report", "scan-other"),
		);
		expect(report.params.handleSelectScanRun).toHaveBeenCalledWith("scan-other");
		expect(report.params.handleGenerateReport).toHaveBeenCalledWith(
			"deterministic",
			"scan-other",
		);
	});

	it("does not invent a target when dashboard evidence has no scan or finding", () => {
		const handlers = setup({
			findings: [],
			selectedScanRunId: "",
		});
		handlers.handleDashboardAction(dashboardAction("review_findings"));
		handlers.handleDashboardAction(dashboardAction("run_diagnostics"));
		expect(handlers.params.handleSelectFinding).not.toHaveBeenCalled();
		expect(handlers.params.runDiagnosticsForScan).not.toHaveBeenCalled();
	});
});
