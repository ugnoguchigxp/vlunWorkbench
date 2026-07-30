import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingReview,
} from "../../api";
import type { buildDecisionGradeView } from "./decision-grade-view";
import type { DashboardAction } from "./diagnostic-dashboard";
import type { ActionQueueItem } from "./work-states";

type SelectedFindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};

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
	handleRetryAutomatedDiagnostic: (scanRunId?: string) => Promise<void>;
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
		if (action.action === "retry_diagnostic") {
			void params.handleRetryAutomatedDiagnostic(action.targetId);
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
		if (action.kind === "retry_diagnostic") {
			void params.handleRetryAutomatedDiagnostic(action.targetId);
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
