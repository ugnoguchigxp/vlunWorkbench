import { useRouterState } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import type {
	AttackSurfaceItem,
	DiagnosticReport,
	DiffScanPreview,
	DynamicArtifact,
	DynamicEvidence,
	DynamicProfileConfig,
	DynamicRun,
	Finding,
	FindingDecision,
	FindingEvidence,
	FindingGroup,
	FindingReview,
	Project,
	ReproductionArtifact,
	ReproductionEvidence,
	ReproductionProfile,
	ReproductionRun,
	ScanEvent,
	ScanProfile,
	ScanReport,
	ScanReview,
	ScanReviewFindingFilter,
	ScanRun,
	ScanRunSummary,
	ScanTargetKind,
	SecurityCheckResult,
} from "../../api";
import { buildDecisionWorkflow } from "./decision-workflow";
import { useAutomatedDiagnosticState } from "./use-automated-diagnostic-state";
import type {
	RemediationPriority,
	RemediationStatus,
} from "./remediation-plan";
import { useDastController } from "./use-dast-controller";

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
/** Owns the stateful React scope consumed by the smaller scan action modules. */
export const useScansControllerBase = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansControllerBaseProps) => {
	const location = useRouterState({ select: (state) => state.location });
	const requestedSearch = useMemo(
		() => new URLSearchParams(location.searchStr),
		[location.searchStr],
	);
	const requestedProjectId = requestedSearch.get("projectId") ?? "";
	const requestedScanRunId = requestedSearch.get("scanRunId") ?? "";
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] =
		useState(requestedProjectId);
	const [projectFolderPath, setProjectFolderPath] = useState("");
	const [projectDefaultBranch, setProjectDefaultBranch] = useState("main");
	const [projectCreateLoading, setProjectCreateLoading] = useState(false);
	const [projectBrowseLoading, setProjectBrowseLoading] = useState(false);
	const [showNewProjectModal, setShowNewProjectModal] = useState(false);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [scanEvents, setScanEvents] = useState<ScanEvent[]>([]);
	const [selectedScanRunId, setSelectedScanRunId] =
		useState(requestedScanRunId);
	const [scanListTab, setScanListTab] = useState<"runs" | "findings">("runs");
	const [scanDetailTab, setScanDetailTab] = useState<ScanDetailTab>("review");
	const [actionQueueFilter, setActionQueueFilter] =
		useState<ActionQueueFilter>("active");
	const [findings, setFindings] = useState<Finding[]>([]);
	const [findingsLoading, setFindingsLoading] = useState(false);
	const [selectedFindingId, setSelectedFindingId] = useState("");
	const [profiles, setProfiles] = useState<ScanProfile[]>([]);
	const [selectedProfileId, setSelectedProfileId] = useState("baseline");
	const [scanTargetKind, setScanTargetKind] = useState<ScanTargetKind>("full");
	const [diffBaseRef, setDiffBaseRef] = useState("HEAD");
	const [diffHeadRef, setDiffHeadRef] = useState("HEAD");
	const [diffIncludeUntracked, setDiffIncludeUntracked] = useState(true);
	const [diffPreview, setDiffPreview] = useState<DiffScanPreview | null>(null);
	const [diffPreviewResolvedInputKey, setDiffPreviewResolvedInputKey] =
		useState<string | null>(null);
	const [diffPreviewLoading, setDiffPreviewLoading] = useState(false);
	const [diffPreviewError, setDiffPreviewError] = useState<string | null>(null);
	const diffPreviewRequestIdRef = useRef(0);
	const [continueOnToolFailure, setContinueOnToolFailure] = useState(true);
	const [scanProjectCodeExecutionConsent, setScanProjectCodeExecutionConsent] =
		useState(false);
	const [timeoutSec, setTimeoutSec] = useState(600);
	const [showRunScanForm, setShowRunScanForm] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [scanSummary, setScanSummary] = useState<ScanRunSummary | null>(null);
	const [scanGroups, setScanGroups] = useState<FindingGroup[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState("");
	const [findingsViewMode, setFindingsViewMode] = useState<"list" | "grouped">(
		"list",
	);
	const [selectedFindingDetails, setSelectedFindingDetails] =
		useState<FindingDetails | null>(null);
	const [allReviews, setAllReviews] = useState<FindingReview[]>([]);
	const [reviewLoading, setReviewLoading] = useState(false);
	const [reviewError, setReviewError] = useState<string | null>(null);
	const [allDecisions, setAllDecisions] = useState<FindingDecision[]>([]);
	const [decisionInput, setDecisionInput] =
		useState<FindingDecision["decision"]>("needs_fix");
	const [reasonInput, setReasonInput] = useState<FindingDecision["reason"]>(
		"confirmed_by_evidence",
	);
	const [commentInput, setCommentInput] = useState("");
	const [linkReviewInput, setLinkReviewInput] = useState(false);
	const [decisionSubmitLoading, setDecisionSubmitLoading] = useState(false);
	const [remediationStatusInput, setRemediationStatusInput] =
		useState<RemediationStatus>("not_started");
	const [remediationOwnerInput, setRemediationOwnerInput] = useState("");
	const [remediationPriorityInput, setRemediationPriorityInput] =
		useState<RemediationPriority>("p2");
	const [remediationDueDateInput, setRemediationDueDateInput] = useState("");
	const [remediationFixInput, setRemediationFixInput] = useState("");
	const [remediationSaveLoading, setRemediationSaveLoading] = useState(false);
	const [reportLoading, setReportLoading] = useState(false);
	const [reports, setReports] = useState<ScanReport[]>([]);
	const [selectedReport, setSelectedReport] = useState<ScanReport | null>(null);
	const [scanReviewLoading, setScanReviewLoading] = useState(false);
	const [scanReviewFindingFilter, setScanReviewFindingFilter] =
		useState<ScanReviewFindingFilter>("all");
	const [scanReviews, setScanReviews] = useState<ScanReview[]>([]);
	const automatedDiagnosticState = useAutomatedDiagnosticState();
	const [reportPreviewContent, setReportPreviewContent] = useState<
		string | null
	>(null);
	const [attackSurfaceItems, setAttackSurfaceItems] = useState<
		AttackSurfaceItem[]
	>([]);
	const [securityCheckResults, setSecurityCheckResults] = useState<
		SecurityCheckResult[]
	>([]);
	const [diagnosticReports, setDiagnosticReports] = useState<
		DiagnosticReport[]
	>([]);
	const [diagnosticLoading, setDiagnosticLoading] = useState(false);
	const [reproProfiles, setReproProfiles] = useState<ReproductionProfile[]>([]);
	const [reproRuns, setReproRuns] = useState<ReproductionRun[]>([]);
	const [selectedReproProfile, setSelectedReproProfile] = useState("");
	const [reproLoading, setReproLoading] = useState(false);
	const [reproError, setReproError] = useState<string | null>(null);
	const [expandedReproRunId, setExpandedReproRunId] = useState<string | null>(
		null,
	);
	const [reproRunArtifacts, setReproRunArtifacts] = useState<
		Record<string, ReproductionArtifact[]>
	>({});
	const [reproRunEvidence, setReproRunEvidence] = useState<
		Record<string, ReproductionEvidence[]>
	>({});
	const [dynamicProfiles, setDynamicProfiles] = useState<
		DynamicProfileConfig[]
	>([]);
	const [dynamicRuns, setDynamicRuns] = useState<DynamicRun[]>([]);
	const [selectedDynamicProfile, setSelectedDynamicProfile] = useState("");
	const [dynamicLoading, setDynamicLoading] = useState(false);
	const [dynamicError, setDynamicError] = useState<string | null>(null);
	const [expandedDynamicRunId, setExpandedDynamicRunId] = useState<
		string | null
	>(null);
	const [dynamicRunArtifacts, setDynamicRunArtifacts] = useState<
		Record<string, DynamicArtifact[]>
	>({});
	const [dynamicRunEvidence, setDynamicRunEvidence] = useState<
		Record<string, DynamicEvidence[]>
	>({});
	const [allowProjectScriptsConsent, setAllowProjectScriptsConsent] =
		useState(false);
	const selectedFindingIdRef = useRef(selectedFindingId);
	const linkReviewDefaultFindingRef = useRef<string | null>(null);
	const [verificationDataLoadedFindingId, setVerificationDataLoadedFindingId] =
		useState<string | null>(null);
	const findingSelectionCacheRef = useRef(
		new Map<string, FindingSelectionBundle>(),
	);
	const findingLoadInFlightRef = useRef(new Map<string, Promise<void>>());
	const findingVerificationCacheRef = useRef(
		new Map<string, FindingVerificationBundle>(),
	);
	const findingVerificationInFlightRef = useRef(
		new Map<string, Promise<void>>(),
	);
	const viewingReport = scanDetailTab === "report";
	const setViewingReport = useCallback((next: boolean) => {
		setScanDetailTab(next ? "report" : "review");
	}, []);
	const dast = useDastController({
		active,
		selectedProjectId,
		setScanRuns,
		setSelectedScanRunId,
	});
	const selectedFindingDastEvidence = useMemo(() => {
		if (!selectedFindingId) return undefined;
		const loadedEvidence = Object.values(dast.dastRunEvidence)
			.flat()
			.filter((item) => item.findingId === selectedFindingId);
		return loadedEvidence.length > 0 ? loadedEvidence : undefined;
	}, [dast.dastRunEvidence, selectedFindingId]);
	const selectedVerificationDataLoaded =
		verificationDataLoadedFindingId === selectedFindingId;
	const selectedDecisionWorkflow = useMemo(() => {
		if (!selectedFindingDetails) return null;
		return buildDecisionWorkflow({
			finding: selectedFindingDetails.finding,
			evidence: selectedFindingDetails.evidence,
			latestDecision: selectedFindingDetails.latestDecision,
			latestReview: selectedFindingDetails.latestReview,
			reproductions: selectedVerificationDataLoaded ? reproRuns : undefined,
			dynamicRuns: selectedVerificationDataLoaded ? dynamicRuns : undefined,
			dastEvidence: selectedFindingDastEvidence,
			reportOptions: DEFAULT_REPORT_OPTIONS,
		});
	}, [
		selectedFindingDetails,
		selectedVerificationDataLoaded,
		reproRuns,
		dynamicRuns,
		selectedFindingDastEvidence,
	]);

	const selectedPollingStatus = scanRuns.find(
		(run) => run.id === selectedScanRunId,
	)?.status;
	const baseScope = {
		...dast,
		actionQueueFilter,
		active,
		allDecisions,
		allReviews,
		allowProjectScriptsConsent,
		attackSurfaceItems,
		...automatedDiagnosticState,
		busy,
		commentInput,
		continueOnToolFailure,
		dast,
		decisionInput,
		decisionSubmitLoading,
		diagnosticLoading,
		diagnosticReports,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
		diffPreview,
		diffPreviewError,
		diffPreviewLoading,
		diffPreviewRequestIdRef,
		diffPreviewResolvedInputKey,
		dynamicError,
		dynamicLoading,
		dynamicProfiles,
		dynamicRunArtifacts,
		dynamicRunEvidence,
		dynamicRuns,
		expandedDynamicRunId,
		expandedReproRunId,
		findingLoadInFlightRef,
		findingSelectionCacheRef,
		findingVerificationCacheRef,
		findingVerificationInFlightRef,
		findings,
		findingsLoading,
		findingsViewMode,
		isScanning,
		linkReviewDefaultFindingRef,
		linkReviewInput,
		location,
		profiles,
		projectBrowseLoading,
		projectCreateLoading,
		projectDefaultBranch,
		projectFolderPath,
		projects,
		reasonInput,
		remediationDueDateInput,
		remediationFixInput,
		remediationOwnerInput,
		remediationPriorityInput,
		remediationSaveLoading,
		remediationStatusInput,
		reportLoading,
		reportPreviewContent,
		reports,
		reproError,
		reproLoading,
		reproProfiles,
		reproRunArtifacts,
		reproRunEvidence,
		reproRuns,
		requestedProjectId,
		requestedScanRunId,
		requestedSearch,
		reviewError,
		reviewLoading,
		runWithBusy,
		scanDetailTab,
		scanEvents,
		scanGroups,
		scanListTab,
		scanReviewFindingFilter,
		scanReviewLoading,
		scanReviews,
		scanRuns,
		scanSummary,
		scanTargetKind,
		scanProjectCodeExecutionConsent,
		securityCheckResults,
		selectedDecisionWorkflow,
		selectedDynamicProfile,
		selectedFindingDastEvidence,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		selectedGroupId,
		selectedPollingStatus,
		selectedProfileId,
		selectedProjectId,
		selectedReport,
		selectedReproProfile,
		selectedScanRunId,
		selectedVerificationDataLoaded,
		setActionQueueFilter,
		setAllDecisions,
		setAllReviews,
		setAllowProjectScriptsConsent,
		setAttackSurfaceItems,
		setCommentInput,
		setContinueOnToolFailure,
		setDecisionInput,
		setDecisionSubmitLoading,
		setDiagnosticLoading,
		setDiagnosticReports,
		setDiffBaseRef,
		setDiffHeadRef,
		setDiffIncludeUntracked,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setDynamicError,
		setDynamicLoading,
		setDynamicProfiles,
		setDynamicRunArtifacts,
		setDynamicRunEvidence,
		setDynamicRuns,
		setErrorText,
		setExpandedDynamicRunId,
		setExpandedReproRunId,
		setFindings,
		setFindingsLoading,
		setFindingsViewMode,
		setIsScanning,
		setLinkReviewInput,
		setProfiles,
		setProjectBrowseLoading,
		setProjectCreateLoading,
		setProjectDefaultBranch,
		setProjectFolderPath,
		setProjects,
		setReasonInput,
		setRemediationDueDateInput,
		setRemediationFixInput,
		setRemediationOwnerInput,
		setRemediationPriorityInput,
		setRemediationSaveLoading,
		setRemediationStatusInput,
		setReportLoading,
		setReportPreviewContent,
		setReports,
		setReproError,
		setReproLoading,
		setReproProfiles,
		setReproRunArtifacts,
		setReproRunEvidence,
		setReproRuns,
		setReviewError,
		setReviewLoading,
		setScanDetailTab,
		setScanEvents,
		setScanGroups,
		setScanListTab,
		setScanReviewFindingFilter,
		setScanReviewLoading,
		setScanReviews,
		setScanRuns,
		setScanSummary,
		setScanProjectCodeExecutionConsent,
		setScanTargetKind,
		setSecurityCheckResults,
		setSelectedDynamicProfile,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedGroupId,
		setSelectedProfileId,
		setSelectedProjectId,
		setSelectedReport,
		setSelectedReproProfile,
		setSelectedScanRunId,
		setShowNewProjectModal,
		setShowRunScanForm,
		setTimeoutSec,
		setVerificationDataLoadedFindingId,
		setViewingReport,
		showNewProjectModal,
		showRunScanForm,
		timeoutSec,
		verificationDataLoadedFindingId,
		viewingReport,
	};
	return baseScope;
};

export type ScansControllerBaseScope = ReturnType<
	typeof useScansControllerBase
>;
