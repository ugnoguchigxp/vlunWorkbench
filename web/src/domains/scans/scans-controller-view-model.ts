import { buildScansNavigationHandlers } from "./scans-navigation-handlers";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};
export type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};

type NavigationParams = Parameters<typeof buildScansNavigationHandlers>[0];
type ControllerViewModelScope = Omit<
	NavigationParams,
	"handleSelectScanRun" | "handleSelectFinding"
> & {
	setSelectedScanRunId: NavigationParams["setSelectedFindingId"];
};

export function buildScansControllerViewModel<
	T extends ControllerViewModelScope,
>(scope: T) {
	const {
		findings,
		selectedScanRunId,
		workflowCompletion,
		selectedFindingIdRef,
		setSelectedFindingId,
		setSelectedFindingDetails,
		setReviewError,
		setScanListTab,
		setScanDetailTab,
		setSelectedScanRunId,
		handleTriggerScanReview,
		handleGenerateReport,
		handleRetryAutomatedDiagnostic,
		runDiagnosticsForScan,
	} = scope;
	const handleSelectScanRun = (scanRunId: string) => {
		setSelectedScanRunId(scanRunId);
		selectedFindingIdRef.current = "";
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setReviewError(null);
		setScanDetailTab("review");
	};
	const handleSelectFinding = (findingId: string) => {
		selectedFindingIdRef.current = findingId;
		setSelectedFindingId(findingId);
		setReviewError(null);
		setScanDetailTab("review");
	};
	const navigation = buildScansNavigationHandlers({
		findings,
		selectedScanRunId,
		workflowCompletion,
		selectedFindingIdRef,
		setSelectedFindingId,
		setSelectedFindingDetails,
		setReviewError,
		setScanListTab,
		setScanDetailTab,
		handleSelectScanRun,
		handleSelectFinding,
		handleTriggerScanReview,
		handleGenerateReport,
		handleRetryAutomatedDiagnostic,
		runDiagnosticsForScan,
	});
	return {
		...scope,
		...navigation,
		handleSelectScanRun,
		handleSelectFinding,
		reportOptions: DEFAULT_REPORT_OPTIONS,
	};
}
