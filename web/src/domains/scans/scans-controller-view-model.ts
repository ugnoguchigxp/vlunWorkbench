import type {
	DynamicProfileConfig,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingReview,
	ReproductionProfile,
	ReproductionRun,
} from "../../api";
import type {
	RemediationPriority,
	RemediationStatus,
} from "./remediation-plan";
import { buildScansNavigationHandlers } from "./scans-derived-controller";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};
const _SCAN_REVIEW_POLL_INTERVAL_MS = 1_500;
const _SCAN_REVIEW_WAIT_TIMEOUT_MS = 630_000;

const _wait = (durationMs: number) =>
	new Promise<void>((resolve) => globalThis.setTimeout(resolve, durationMs));

export type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};
type FindingDetails = {
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
};
type ScanDetailTab = "review" | "verification" | "report";
type ActionQueueFilter =
	| "active"
	| "all"
	| "needs_review"
	| "needs_verification"
	| "ready_for_report"
	| "blocked_by_evidence";
type FindingSelectionBundle = {
	details: FindingDetails;
	reviews: FindingReview[];
	decisions: FindingDecision[];
};
type FindingVerificationBundle = {
	reproductionProfiles: ReproductionProfile[];
	selectedReproductionProfile: string;
	reproductions: ReproductionRun[];
	dynamicProfiles: DynamicProfileConfig[];
	selectedDynamicProfile: string;
	dynamicRuns: DynamicRun[];
};
const _remediationStatuses: RemediationStatus[] = [
	"not_started",
	"planned",
	"in_progress",
	"fixed",
	"accepted",
	"false_positive",
	"deferred",
];
const _remediationPriorities: RemediationPriority[] = ["p0", "p1", "p2", "p3"];

export function buildScansControllerViewModel<
	T extends Record<string, unknown>,
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
	} = scope as Record<string, any>;
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
