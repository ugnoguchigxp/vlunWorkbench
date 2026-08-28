import { useCallback, useMemo } from "react";
import { buildDecisionWorkflow } from "./decision-workflow";
import { useFindingLoadEffects } from "./findings/use-finding-load-effects";
import { useScanFindingsEffects } from "./findings/use-scan-findings-effects";
import { useScanFindingsState } from "./findings/use-scan-findings-state";
import { useScanDiagnosticsEffects } from "./handoff/use-scan-diagnostics-effects";
import { useScanDiagnosticsState } from "./handoff/use-scan-diagnostics-state";
import { useScanReportsEffects } from "./reporting/use-scan-reports-effects";
import { useScanReportsState } from "./reporting/use-scan-reports-state";
import { useDastController } from "./use-dast-controller";
import { isScanLaunchInProgress } from "./workspace/scan-launch-state";
import { selectProgressScanRun } from "./workspace/scan-progress-model";
import { useScanLaunchEffects } from "./workspace/use-scan-launch-effects";
import { useScanLaunchState } from "./workspace/use-scan-launch-state";
import { useSelectedScanResultRefresh } from "./workspace/use-selected-scan-result-refresh";
import { useSpecializedScanLaunch } from "./workspace/use-specialized-scan-launch";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};
export type ScansControllerBaseProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};

/** Owns the stateful React scope consumed by the smaller scan action modules. */
export const useScansControllerBase = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansControllerBaseProps) => {
	const launch = useScanLaunchState();
	const specializedLaunch = useSpecializedScanLaunch({
		active,
		selectedProjectId: launch.selectedProjectId,
	});
	const findings = useScanFindingsState();
	const reports = useScanReportsState();
	const diagnostics = useScanDiagnosticsState();
	const dast = useDastController({
		active,
		selectedProjectId: launch.selectedProjectId,
		setScanRuns: launch.setScanRuns,
		setSelectedScanRunId: launch.setSelectedScanRunId,
	});
	const { setScanDetailTab } = launch;
	const viewingReport = launch.scanDetailTab === "report";
	const setViewingReport = useCallback(
		(next: boolean) => {
			setScanDetailTab(next ? "report" : "review");
		},
		[setScanDetailTab],
	);
	const selectedFindingDastEvidence = useMemo(() => {
		if (!findings.selectedFindingId) return undefined;
		const loadedEvidence = Object.values(dast.dastRunEvidence)
			.flat()
			.filter((item) => item.findingId === findings.selectedFindingId);
		return loadedEvidence.length > 0 ? loadedEvidence : undefined;
	}, [dast.dastRunEvidence, findings.selectedFindingId]);
	const selectedVerificationDataLoaded =
		findings.verificationDataLoadedFindingId === findings.selectedFindingId;
	const selectedDecisionWorkflow = useMemo(() => {
		if (!findings.selectedFindingDetails) return null;
		return buildDecisionWorkflow({
			finding: findings.selectedFindingDetails.finding,
			evidence: findings.selectedFindingDetails.evidence,
			latestDecision: findings.selectedFindingDetails.latestDecision,
			latestReview: findings.selectedFindingDetails.latestReview,
			reproductions: selectedVerificationDataLoaded
				? findings.reproRuns
				: undefined,
			dynamicRuns: selectedVerificationDataLoaded
				? findings.dynamicRuns
				: undefined,
			dastEvidence: selectedFindingDastEvidence,
			reportOptions: DEFAULT_REPORT_OPTIONS,
		});
	}, [
		findings.selectedFindingDetails,
		selectedVerificationDataLoaded,
		findings.reproRuns,
		findings.dynamicRuns,
		selectedFindingDastEvidence,
	]);
	const selectedPollingStatus = launch.scanRuns.find(
		(run) => run.id === launch.selectedScanRunId,
	)?.status;
	const progressScanRun = selectProgressScanRun(
		launch.scanRuns,
		launch.selectedScanRunId,
		launch.selectedProjectId,
	);
	const progressScanEvents =
		progressScanRun?.id === launch.selectedScanRunId
			? launch.scanEvents
			: launch.activeScanEvents;
	const scanLaunchInProgress = isScanLaunchInProgress(
		launch.isScanning,
		launch.scanRuns,
	);
	const launchEffects = useScanLaunchEffects({
		...launch,
		active,
		setErrorText,
	});
	useScanFindingsEffects({
		...findings,
		active,
		scanRuns: launch.scanRuns,
		selectedDecisionWorkflow,
		selectedProjectId: launch.selectedProjectId,
		selectedScanRunId: launch.selectedScanRunId,
		setErrorText,
		setScanDetailTab,
	});
	const findingLoad = useFindingLoadEffects({
		...findings,
		active,
		runWithBusy,
		scanDetailTab: launch.scanDetailTab,
		selectedProfileId: launch.selectedProfileId,
	});
	useScanReportsEffects({
		...reports,
		active,
		scanDetailTab: launch.scanDetailTab,
		selectedScanRunId: launch.selectedScanRunId,
	});
	useScanDiagnosticsEffects({
		...diagnostics,
		active,
		scanRuns: launch.scanRuns,
		selectedScanRunId: launch.selectedScanRunId,
		setErrorText,
		setReports: reports.setReports,
		setSelectedReport: reports.setSelectedReport,
	});
	useSelectedScanResultRefresh({
		active,
		selectedPollingStatus,
		selectedProjectId: launch.selectedProjectId,
		selectedScanRunId: launch.selectedScanRunId,
		setErrorText,
		setFindings: findings.setFindings,
		setReports: reports.setReports,
		setScanEvents: launch.setScanEvents,
		setScanReviews: diagnostics.setScanReviews,
		setScanRuns: launch.setScanRuns,
		setScanSummary: findings.setScanSummary,
	});
	return {
		...dast,
		...specializedLaunch,
		...launch,
		...findings,
		...reports,
		...diagnostics,
		...launchEffects,
		...findingLoad,
		active,
		busy,
		dast,
		isScanning: scanLaunchInProgress,
		progressScanEvents,
		progressScanRun,
		runWithBusy,
		selectedDecisionWorkflow,
		selectedFindingDastEvidence,
		selectedPollingStatus,
		selectedVerificationDataLoaded,
		setErrorText,
		setViewingReport,
		viewingReport,
	};
};

export type ScansControllerBaseScope = ReturnType<
	typeof useScansControllerBase
>;
