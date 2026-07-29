import { useRouterState } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type AttackSurfaceItem,
	browseProjectFolder,
	cancelScan,
	createFindingDecision,
	createProject,
	type DiagnosticReport,
	type DynamicArtifact,
	type DynamicEvidence,
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingGroup,
	type FindingReview,
	fetchDynamicRunArtifacts,
	fetchFinding,
	fetchFindingDecisions,
	fetchFindingDynamicRuns,
	fetchFindingReproductions,
	fetchFindingReviews,
	fetchProjectDynamicProfiles,
	fetchProjects,
	fetchReproductionProfiles,
	fetchReproductionRunArtifacts,
	fetchScan,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanEvents,
	fetchScanFindings,
	fetchScanGroups,
	fetchScanProfiles,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	fetchScanSummary,
	fetchScans,
	generateDiagnosticReport,
	generateScanReport,
	type Project,
	previewScan,
	type ReproductionArtifact,
	type ReproductionEvidence,
	type ReproductionProfile,
	type ReproductionRun,
	runScanAttackSurfaceInventory,
	runScanSecurityChecks,
	type ScanEvent,
	type ScanProfile,
	type ScanReport,
	type ScanReview,
	type ScanReviewFindingFilter,
	type ScanRun,
	type ScanRunSummary,
	type DiffScanPreview,
	type ScanTarget,
	type ScanTargetKind,
	type SecurityCheckResult,
	startScan,
	triggerFindingDynamicRun,
	triggerFindingReproduction,
	triggerFindingReview,
	triggerScanReview,
} from "../../api";
import { buildDecisionWorkflow } from "./decision-workflow";
import {
	type RemediationPriority,
	type RemediationStatus,
	readRemediationMetadata,
} from "./remediation-plan";
import {
	buildScansNavigationHandlers,
	useScansDerivedState,
} from "./scans-derived-controller";
import { useDastController } from "./use-dast-controller";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};
const SCAN_REVIEW_POLL_INTERVAL_MS = 1_500;
const SCAN_REVIEW_WAIT_TIMEOUT_MS = 630_000;

const wait = (durationMs: number) =>
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
const remediationStatuses: RemediationStatus[] = [
	"not_started",
	"planned",
	"in_progress",
	"fixed",
	"accepted",
	"false_positive",
	"deferred",
];
const remediationPriorities: RemediationPriority[] = ["p0", "p1", "p2", "p3"];

export const useScansController = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansDomainSectionProps) => {
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

	useEffect(() => {
		selectedFindingIdRef.current = selectedFindingId;
	}, [selectedFindingId]);

	useEffect(() => {
		if (!selectedFindingId) {
			linkReviewDefaultFindingRef.current = null;
			setLinkReviewInput(false);
			setRemediationStatusInput("not_started");
			setRemediationOwnerInput("");
			setRemediationPriorityInput("p2");
			setRemediationDueDateInput("");
			setRemediationFixInput("");
			return;
		}
		if (
			!selectedFindingDetails ||
			selectedFindingDetails.finding.id !== selectedFindingId ||
			linkReviewDefaultFindingRef.current === selectedFindingId
		) {
			return;
		}
		linkReviewDefaultFindingRef.current = selectedFindingId;
		setDecisionInput("needs_fix");
		setReasonInput(
			selectedDecisionWorkflow?.recommendedReason ?? "confirmed_by_evidence",
		);
		setCommentInput("");
		setLinkReviewInput(Boolean(selectedFindingDetails.latestReview));
	}, [selectedFindingId, selectedFindingDetails, selectedDecisionWorkflow]);

	useEffect(() => {
		const decision = selectedFindingDetails?.latestDecision;
		const metadata = readRemediationMetadata(decision);
		const fallbackStatus =
			decision?.decision === "accepted"
				? "accepted"
				: decision?.decision === "false_positive"
					? "false_positive"
					: decision?.decision === "deferred"
						? "deferred"
						: "not_started";
		setRemediationStatusInput(metadata.status ?? fallbackStatus);
		setRemediationOwnerInput(metadata.owner ?? "");
		setRemediationPriorityInput(metadata.priority ?? "p2");
		setRemediationDueDateInput(metadata.dueDate ?? "");
		setRemediationFixInput(
			metadata.recommendedFix ??
				selectedFindingDetails?.latestReview?.remediationDirection ??
				"",
		);
	}, [selectedFindingDetails]);

	useEffect(() => {
		if (!active) return;
		void fetchProjects()
			.then((items) => {
				setProjects(items);
				setSelectedProjectId((current) => {
					const preferred = requestedProjectId || current;
					return items.some((item) => item.id === preferred)
						? preferred
						: (items[0]?.id ?? "");
				});
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "プロジェクトの読み込みに失敗しました。",
				),
			);
	}, [active, requestedProjectId, setErrorText]);

	useEffect(() => {
		if (!active || !selectedProjectId) return;
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setScanDetailTab("review");
		void fetchScans(selectedProjectId)
			.then((runs) => {
				setScanRuns(runs);
				setSelectedScanRunId(
					runs.some((run) => run.id === requestedScanRunId)
						? requestedScanRunId
						: (runs[0]?.id ?? ""),
				);
				if (!runs[0]) {
					setFindings([]);
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "scan の読み込みに失敗しました。",
				),
			);
	}, [active, requestedScanRunId, selectedProjectId, setErrorText]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanEvents([]);
			return;
		}
		if (
			selectedPollingStatus !== "queued" &&
			selectedPollingStatus !== "running"
		) {
			void fetchScanEvents(selectedScanRunId)
				.then(setScanEvents)
				.catch(() => {});
			return;
		}
		let mounted = true;
		let polling = false;
		const poll = async () => {
			if (polling) return;
			polling = true;
			try {
				const [scan, events] = await Promise.all([
					fetchScan(selectedScanRunId),
					fetchScanEvents(selectedScanRunId),
				]);
				if (!mounted) return;
				setScanEvents(events);
				setScanRuns((runs) =>
					runs.map((item) => (item.id === scan.id ? scan : item)),
				);
				if (scan.status !== "queued" && scan.status !== "running") {
					const [runs, nextFindings, nextSummary, nextReviews, nextReports] =
						await Promise.all([
							fetchScans(scan.projectId),
							fetchScanFindings(scan.id),
							fetchScanSummary(scan.id).catch(() => null),
							fetchScanReviews(scan.id),
							fetchScanReports(scan.id),
						]);
					if (!mounted) return;
					setScanRuns(runs);
					setFindings(nextFindings);
					setScanSummary(nextSummary);
					setScanReviews(nextReviews);
					setReports(nextReports);
				}
			} catch (error) {
				if (mounted)
					setErrorText(error instanceof Error ? error.message : String(error));
			} finally {
				polling = false;
			}
		};
		void poll();
		const timer = setInterval(() => void poll(), 1_500);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, [active, selectedPollingStatus, selectedScanRunId, setErrorText]);

	useEffect(() => {
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setAllReviews([]);
		setReviewError(null);
		setAllDecisions([]);
		setScanDetailTab("review");
		if (!active || !selectedScanRunId) {
			setFindingsLoading(false);
			return;
		}
		setFindingsLoading(true);
		void fetchScanFindings(selectedScanRunId)
			.then((items) => {
				setFindings(items);
				setSelectedFindingId((current) =>
					current && items.some((item) => item.id === current) ? current : "",
				);
				if (!items.some((item) => item.id === selectedFindingIdRef.current)) {
					setSelectedFindingDetails(null);
				}
			})
			.catch((err) =>
				setErrorText(
					err instanceof Error
						? err.message
						: "finding の読み込みに失敗しました。",
				),
			)
			.finally(() => setFindingsLoading(false));
	}, [active, selectedScanRunId, setErrorText]);

	useEffect(() => {
		if (!active) return;
		void fetchScanProfiles().then(setProfiles).catch(console.error);
	}, [active]);

	useEffect(() => {
		const profile = profiles.find((item) => item.id === selectedProfileId);
		if (!profile) return;
		const supported = profile.supportedTargets ?? ["full"];
		if (supported.includes(scanTargetKind)) return;
		const nextKind = supported.includes("full")
			? "full"
			: supported.includes("working_tree")
				? "working_tree"
				: supported[0];
		if (nextKind) setScanTargetKind(nextKind);
	}, [profiles, scanTargetKind, selectedProfileId]);

	const diffPreviewInputKey = JSON.stringify([
		selectedProjectId,
		selectedProfileId,
		scanTargetKind,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
	]);
	const diffPreviewCurrent =
		diffPreview !== null && diffPreviewResolvedInputKey === diffPreviewInputKey;
	const previousDiffPreviewInputKey = useRef(diffPreviewInputKey);
	useEffect(() => {
		if (previousDiffPreviewInputKey.current === diffPreviewInputKey) return;
		previousDiffPreviewInputKey.current = diffPreviewInputKey;
		diffPreviewRequestIdRef.current++;
		setDiffPreview(null);
		setDiffPreviewResolvedInputKey(null);
		setDiffPreviewLoading(false);
		setDiffPreviewError(null);
	}, [diffPreviewInputKey]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanSummary(null);
			setScanGroups([]);
			setSelectedGroupId("");
			return;
		}
		void fetchScanSummary(selectedScanRunId)
			.then(setScanSummary)
			.catch(() => setScanSummary(null));
		void fetchScanGroups(selectedScanRunId)
			.then(({ groups }) => setScanGroups(groups))
			.catch(() => setScanGroups([]));
	}, [active, selectedScanRunId]);

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setReports([]);
			setSelectedReport(null);
			setScanReviews([]);
			setReportPreviewContent(null);
			setAttackSurfaceItems([]);
			setSecurityCheckResults([]);
			setDiagnosticReports([]);
			return;
		}
		void fetchScanReports(selectedScanRunId).then((items) => {
			setReports(items);
			setSelectedReport(items[0] ?? null);
			if (!items[0]) setReportPreviewContent(null);
		});
		void fetchScanReviews(selectedScanRunId)
			.then(setScanReviews)
			.catch(() => setScanReviews([]));
		void fetchScanAttackSurface(selectedScanRunId)
			.then(({ items }) => setAttackSurfaceItems(items))
			.catch(() => setAttackSurfaceItems([]));
		void fetchScanSecurityChecks(selectedScanRunId)
			.then(({ results }) => setSecurityCheckResults(results))
			.catch(() => setSecurityCheckResults([]));
		void fetchScanDiagnosticReports(selectedScanRunId)
			.then(({ reports }) => setDiagnosticReports(reports))
			.catch(() => setDiagnosticReports([]));
	}, [active, selectedScanRunId]);

	useEffect(() => {
		if (
			!active ||
			scanDetailTab !== "report" ||
			!selectedReport ||
			selectedReport.status !== "completed"
		) {
			if (scanDetailTab === "report" || !selectedReport) {
				setReportPreviewContent(null);
			}
			return;
		}
		void fetch(`/api/scan-reports/${selectedReport.id}/download`)
			.then((response) => (response.ok ? response.text() : null))
			.then(setReportPreviewContent)
			.catch(() => setReportPreviewContent(null));
	}, [active, scanDetailTab, selectedReport]);

	const applyFindingSelectionBundle = useCallback(
		(findingId: string, bundle: FindingSelectionBundle) => {
			if (selectedFindingIdRef.current !== findingId) return;
			setSelectedFindingDetails(bundle.details);
			setAllReviews(bundle.reviews);
			setAllDecisions(bundle.decisions);
		},
		[],
	);

	const applyFindingVerificationBundle = useCallback(
		(findingId: string, bundle: FindingVerificationBundle) => {
			if (selectedFindingIdRef.current !== findingId) return;
			setReproProfiles(bundle.reproductionProfiles);
			setSelectedReproProfile(bundle.selectedReproductionProfile);
			setReproRuns(bundle.reproductions);
			setDynamicProfiles(bundle.dynamicProfiles);
			setSelectedDynamicProfile(bundle.selectedDynamicProfile);
			setDynamicRuns(bundle.dynamicRuns);
			setVerificationDataLoadedFindingId(findingId);
		},
		[],
	);

	const loadFindingDetails = useCallback(
		async (findingId: string, quiet = false, forceRefresh = false) => {
			const fetchAction = async () => {
				if (!forceRefresh) {
					const cached = findingSelectionCacheRef.current.get(findingId);
					if (cached) {
						applyFindingSelectionBundle(findingId, cached);
						return;
					}
					const inFlight = findingLoadInFlightRef.current.get(findingId);
					if (inFlight) {
						await inFlight;
						const loaded = findingSelectionCacheRef.current.get(findingId);
						if (loaded) applyFindingSelectionBundle(findingId, loaded);
						return;
					}
				}
				const request = (async () => {
					const details = await fetchFinding(findingId);
					const [reviewsResult, decisionsResult] = await Promise.all([
						fetchFindingReviews(findingId).catch(() => ({ reviews: [] })),
						fetchFindingDecisions(findingId).catch(() => ({ decisions: [] })),
					]);
					const bundle: FindingSelectionBundle = {
						details,
						reviews: reviewsResult.reviews,
						decisions: decisionsResult.decisions,
					};
					findingSelectionCacheRef.current.set(findingId, bundle);
					applyFindingSelectionBundle(findingId, bundle);
				})();
				findingLoadInFlightRef.current.set(findingId, request);
				try {
					await request;
				} finally {
					findingLoadInFlightRef.current.delete(findingId);
				}
			};
			if (quiet) {
				await fetchAction().catch((err) =>
					console.error("Failed to silently reload finding details:", err),
				);
			} else {
				await runWithBusy(fetchAction);
			}
		},
		[applyFindingSelectionBundle, runWithBusy],
	);

	const loadFindingVerification = useCallback(
		async (findingId: string) => {
			const cached = findingVerificationCacheRef.current.get(findingId);
			if (cached) {
				applyFindingVerificationBundle(findingId, cached);
				return;
			}
			const inFlight = findingVerificationInFlightRef.current.get(findingId);
			if (inFlight) {
				await inFlight;
				const loaded = findingVerificationCacheRef.current.get(findingId);
				if (loaded) applyFindingVerificationBundle(findingId, loaded);
				return;
			}
			const request = (async () => {
				const detailsInFlight = findingLoadInFlightRef.current.get(findingId);
				if (detailsInFlight) await detailsInFlight;
				const details =
					findingSelectionCacheRef.current.get(findingId)?.details ??
					(await fetchFinding(findingId));
				const [
					reproductionProfilesResult,
					reproductionsResult,
					dynamicProfilesResult,
					dynamicRunsResult,
				] = await Promise.all([
					fetchReproductionProfiles(findingId).catch(() => ({ profiles: [] })),
					fetchFindingReproductions(findingId).catch(() => ({
						reproductions: [],
					})),
					fetchProjectDynamicProfiles(details.finding.projectId).catch(() => ({
						configs: [],
					})),
					fetchFindingDynamicRuns(findingId).catch(() => ({
						dynamicRuns: [],
					})),
				]);
				const bundle: FindingVerificationBundle = {
					reproductionProfiles: reproductionProfilesResult.profiles,
					selectedReproductionProfile:
						reproductionProfilesResult.profiles.find((p) => p.isApplicable)
							?.id ?? "",
					reproductions: reproductionsResult.reproductions,
					dynamicProfiles: dynamicProfilesResult.configs,
					selectedDynamicProfile:
						dynamicProfilesResult.configs.find((p) => p.enabled)?.profileId ??
						"",
					dynamicRuns: dynamicRunsResult.dynamicRuns,
				};
				findingVerificationCacheRef.current.set(findingId, bundle);
				applyFindingVerificationBundle(findingId, bundle);
			})();
			findingVerificationInFlightRef.current.set(findingId, request);
			try {
				await request;
			} finally {
				findingVerificationInFlightRef.current.delete(findingId);
			}
		},
		[applyFindingVerificationBundle],
	);

	useEffect(() => {
		if (!active || !selectedFindingId) {
			setSelectedFindingDetails(null);
			setAllReviews([]);
			setAllDecisions([]);
			setReproProfiles([]);
			setSelectedReproProfile("");
			setReproRuns([]);
			setDynamicProfiles([]);
			setSelectedDynamicProfile("");
			setDynamicRuns([]);
			setVerificationDataLoadedFindingId(null);
			return;
		}
		void loadFindingDetails(selectedFindingId);
	}, [active, selectedFindingId, loadFindingDetails]);

	useEffect(() => {
		if (!active || scanDetailTab !== "verification" || !selectedFindingId)
			return;
		void loadFindingVerification(selectedFindingId).catch((err) =>
			console.error("Failed to load finding verification data:", err),
		);
	}, [active, scanDetailTab, selectedFindingId, loadFindingVerification]);

	useEffect(() => {
		if (
			!active ||
			!selectedFindingId ||
			selectedFindingDetails?.latestReview?.status !== "running"
		)
			return;
		let mounted = true;
		const poll = setInterval(() => {
			void fetchFinding(selectedFindingId)
				.then((res) => {
					if (!mounted) return;
					setSelectedFindingDetails(res);
					if (res.latestReview?.status !== "running") {
						clearInterval(poll);
						void fetchFindingReviews(selectedFindingId).then(({ reviews }) =>
							setAllReviews(reviews),
						);
					}
				})
				.catch(console.error);
		}, 2500);
		return () => {
			mounted = false;
			clearInterval(poll);
		};
	}, [active, selectedFindingId, selectedFindingDetails?.latestReview?.status]);

	const buildSelectedScanTarget = (): ScanTarget => {
		if (scanTargetKind === "full") return { kind: "full" };
		if (scanTargetKind === "commit") {
			return {
				kind: "commit",
				head: diffHeadRef.trim(),
				...(diffBaseRef.trim() ? { base: diffBaseRef.trim() } : {}),
			};
		}
		if (scanTargetKind === "range") {
			return {
				kind: "range",
				base: diffBaseRef.trim(),
				head: diffHeadRef.trim(),
			};
		}
		return {
			kind: "working_tree",
			...(diffBaseRef.trim() ? { base: diffBaseRef.trim() } : {}),
			includeUntracked: diffIncludeUntracked,
		};
	};

	const handleScanTargetKindChange = (kind: ScanTargetKind) => {
		setScanTargetKind(kind);
		const project = projects.find((item) => item.id === selectedProjectId);
		setDiffBaseRef(
			kind === "range"
				? (project?.defaultBranch ?? "main")
				: kind === "working_tree"
					? "HEAD"
					: "",
		);
		setDiffHeadRef("HEAD");
	};

	const handlePreviewDiffTarget = async () => {
		if (!selectedProjectId || !selectedProfileId || scanTargetKind === "full")
			return;
		const target = buildSelectedScanTarget();
		if (target.kind === "full") return;
		if (
			("head" in target && !target.head) ||
			(target.kind === "range" && !target.base)
		) {
			setDiffPreviewError("base/head refを入力してください。");
			return;
		}
		const requestId = ++diffPreviewRequestIdRef.current;
		setDiffPreviewLoading(true);
		setDiffPreviewError(null);
		try {
			const preview = await previewScan(selectedProjectId, {
				profile: selectedProfileId,
				target,
			});
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreview(preview);
				setDiffPreviewResolvedInputKey(diffPreviewInputKey);
			}
		} catch (error) {
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreview(null);
				setDiffPreviewResolvedInputKey(null);
				setDiffPreviewError(
					error instanceof Error
						? error.message
						: "差分previewに失敗しました。",
				);
			}
		} finally {
			if (diffPreviewRequestIdRef.current === requestId) {
				setDiffPreviewLoading(false);
			}
		}
	};

	const handleStartScanProfile = async () => {
		if (!selectedProjectId || !selectedProfileId || timeoutSec <= 0) return;
		const project = projects.find((item) => item.id === selectedProjectId);
		if (project?.pathPolicy?.status !== "allowed") {
			setErrorText(
				"このプロジェクトのパスは現在のPROJECT_ALLOWED_ROOTSでは実行できません。",
			);
			return;
		}
		setIsScanning(true);
		setErrorText(null);
		try {
			const target = buildSelectedScanTarget();
			if (target.kind !== "full" && !diffPreviewCurrent) {
				throw new Error("差分を確認してからscanを開始してください。");
			}
			const res = await startScan(selectedProjectId, {
				profile: selectedProfileId,
				continueOnToolFailure,
				timeoutSec,
				target,
				...(target.kind !== "full" && diffPreviewCurrent && diffPreview
					? { expectedTargetDigest: diffPreview.target.targetDigest }
					: {}),
			});
			setScanRuns(await fetchScans(selectedProjectId));
			if (res.scan?.id) {
				setSelectedScanRunId(res.scan.id);
				setSelectedFindingId("");
				setSelectedFindingDetails(null);
				setScanListTab("runs");
				setScanDetailTab("review");
			}
			setDiffPreview(null);
			setDiffPreviewResolvedInputKey(null);
			setShowRunScanForm(false);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "scan の実行に失敗しました。",
			);
		} finally {
			setIsScanning(false);
		}
	};

	const handleCancelScan = async () => {
		if (!selectedScanRunId) return;
		setErrorText(null);
		try {
			const scan = await cancelScan(selectedScanRunId);
			setScanRuns((runs) =>
				runs.map((item) => (item.id === scan.id ? scan : item)),
			);
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "scan の取消に失敗しました。",
			);
		}
	};

	const handleSelectProjectFolder = (path: string) => {
		setProjectFolderPath(path);
	};

	const handleBrowseProjectFolder = async () => {
		setProjectBrowseLoading(true);
		setErrorText(null);
		try {
			const res = await browseProjectFolder();
			if (res.path) handleSelectProjectFolder(res.path);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "プロジェクトフォルダの選択に失敗しました。",
			);
		} finally {
			setProjectBrowseLoading(false);
		}
	};

	const handleCreateProjectFromFolder = async () => {
		const repoPath = projectFolderPath.trim();
		if (!repoPath) return;

		setProjectCreateLoading(true);
		setErrorText(null);
		try {
			const created = await createProject({
				repoPath,
				defaultBranch: projectDefaultBranch.trim() || "main",
			});
			setProjects((prev) => {
				const others = prev.filter((item) => item.id !== created.id);
				return [created, ...others];
			});
			setSelectedProjectId(created.id);
			setProjectFolderPath(created.repoPath);
			setShowNewProjectModal(false);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "プロジェクトフォルダの登録に失敗しました。",
			);
		} finally {
			setProjectCreateLoading(false);
		}
	};

	const handleGenerateReport = async (
		summaryMode:
			| "deterministic"
			| "deterministic_with_llm_summary" = "deterministic",
		scanRunId = selectedScanRunId,
	) => {
		if (!scanRunId) return;
		setReportLoading(true);
		setErrorText(null);
		try {
			const defaultTitle =
				scanRunId === selectedScanRunId
					? reportQualityPreview.recommendedReportTitle
					: `セキュリティレポート - ${scanRunId.slice(0, 8)}`;
			const res = await generateScanReport(scanRunId, {
				format: "markdown",
				title: defaultTitle,
				...DEFAULT_REPORT_OPTIONS,
				summaryMode,
			});
			const list = await fetchScanReports(scanRunId);
			setReports(list);
			setSelectedReport(
				list.find((item) => item.id === res.report.id) ?? res.report,
			);
			setScanDetailTab("report");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "レポート生成に失敗しました。",
			);
		} finally {
			setReportLoading(false);
		}
	};

	const handleTriggerScanReview = async (scanRunId = selectedScanRunId) => {
		if (!scanRunId) return;
		setScanReviewLoading(true);
		setErrorText(null);
		try {
			const started = await triggerScanReview(scanRunId, {
				findingFilter: scanReviewFindingFilter,
			});
			setScanDetailTab("review");
			if (!started.result.ok) {
				throw new Error(
					started.result.error ?? "scan review を開始できませんでした。",
				);
			}

			const deadline = Date.now() + SCAN_REVIEW_WAIT_TIMEOUT_MS;
			while (true) {
				const reviews = await fetchScanReviews(scanRunId);
				setScanReviews(reviews);
				const review = reviews.find(
					(item) => item.id === started.result.reviewId,
				);
				if (review?.status === "completed") break;
				if (review?.status === "failed") {
					throw new Error(
						review.errorMessage ?? "scan review の生成に失敗しました。",
					);
				}
				if (Date.now() >= deadline) {
					throw new Error(
						"scan review の完了待機がタイムアウトしました。レビュー一覧から実行状態を確認してください。",
					);
				}
				await wait(SCAN_REVIEW_POLL_INTERVAL_MS);
			}
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "scan レビューの実行に失敗しました。",
			);
		} finally {
			setScanReviewLoading(false);
		}
	};

	const reloadDiagnostics = async (scanRunId = selectedScanRunId) => {
		if (!scanRunId) return;
		const [inventory, checks, diagnostic] = await Promise.all([
			fetchScanAttackSurface(scanRunId).catch(() => ({ items: [] })),
			fetchScanSecurityChecks(scanRunId).catch(() => ({ results: [] })),
			fetchScanDiagnosticReports(scanRunId).catch(() => ({
				reports: [],
			})),
		]);
		setAttackSurfaceItems(inventory.items);
		setSecurityCheckResults(checks.results);
		setDiagnosticReports(diagnostic.reports);
	};

	const runDiagnosticsForScan = async (scanRunId: string) => {
		if (!scanRunId) return;
		setDiagnosticLoading(true);
		setErrorText(null);
		try {
			await runScanAttackSurfaceInventory(scanRunId);
			await runScanSecurityChecks(scanRunId);
			await reloadDiagnostics(scanRunId);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "診断の実行に失敗しました。",
			);
		} finally {
			setDiagnosticLoading(false);
		}
	};

	const handleRunDiagnostics = async () => {
		if (!selectedScanRunId) return;
		await runDiagnosticsForScan(selectedScanRunId);
	};

	const generateDiagnosticReportForScan = async (scanRunId: string) => {
		if (!scanRunId) return;
		setDiagnosticLoading(true);
		setErrorText(null);
		try {
			await generateDiagnosticReport(scanRunId);
			await reloadDiagnostics(scanRunId);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "診断レポートの生成に失敗しました。",
			);
		} finally {
			setDiagnosticLoading(false);
		}
	};

	const handleGenerateDiagnosticReport = async () => {
		if (!selectedScanRunId) return;
		await generateDiagnosticReportForScan(selectedScanRunId);
	};

	const handleRunAttackSurfaceInventory = async () => {
		if (!selectedScanRunId) return;
		setDiagnosticLoading(true);
		setErrorText(null);
		try {
			await runScanAttackSurfaceInventory(selectedScanRunId);
			await reloadDiagnostics(selectedScanRunId);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "攻撃面 inventory の実行に失敗しました。",
			);
		} finally {
			setDiagnosticLoading(false);
		}
	};

	const handleRunSecurityChecks = async () => {
		if (!selectedScanRunId) return;
		setDiagnosticLoading(true);
		setErrorText(null);
		try {
			await runScanSecurityChecks(selectedScanRunId);
			await reloadDiagnostics(selectedScanRunId);
		} catch (err) {
			setErrorText(
				err instanceof Error
					? err.message
					: "セキュリティ検査の実行に失敗しました。",
			);
		} finally {
			setDiagnosticLoading(false);
		}
	};

	const handleTriggerReview = async () => {
		if (!selectedFindingId) return;
		setReviewLoading(true);
		setErrorText(null);
		setReviewError(null);
		try {
			const res = await triggerFindingReview(selectedFindingId);
			await loadFindingDetails(selectedFindingId, true, true);
			if (selectedScanRunId)
				setFindings(await fetchScanFindings(selectedScanRunId));
			if (!res.ok) {
				const message = res.error || "LLM レビューの起動に失敗しました。";
				setReviewError(message);
				setErrorText(message);
			}
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: "LLM レビューの起動に失敗しました。";
			setReviewError(message);
			setErrorText(message);
		} finally {
			setReviewLoading(false);
		}
	};

	const handleDecisionSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!selectedFindingId) return;
		setDecisionSubmitLoading(true);
		try {
			await createFindingDecision(selectedFindingId, {
				decision: decisionInput,
				reason: reasonInput,
				comment: commentInput || undefined,
				linkedReviewId:
					linkReviewInput && selectedFindingDetails?.latestReview
						? selectedFindingDetails.latestReview.id
						: undefined,
			});
			await loadFindingDetails(selectedFindingId, true, true);
			if (selectedScanRunId)
				setFindings(await fetchScanFindings(selectedScanRunId));
			setCommentInput("");
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Decision 記録に失敗しました。",
			);
		} finally {
			setDecisionSubmitLoading(false);
		}
	};

	const handleRemediationSubmit = async (event: FormEvent) => {
		event.preventDefault();
		if (!selectedFindingId || !selectedFindingDetails?.latestDecision) {
			setErrorText("修正計画は finding の Decision 記録後に保存できます。");
			return;
		}
		setRemediationSaveLoading(true);
		const latestDecision = selectedFindingDetails.latestDecision;
		try {
			await createFindingDecision(selectedFindingId, {
				decision: latestDecision.decision,
				reason: latestDecision.reason,
				comment: latestDecision.comment ?? undefined,
				linkedReviewId: latestDecision.linkedReviewId ?? undefined,
				metadata: {
					...(latestDecision.metadata ?? {}),
					remediation: {
						status: remediationStatuses.includes(remediationStatusInput)
							? remediationStatusInput
							: "not_started",
						owner: remediationOwnerInput.trim() || null,
						priority: remediationPriorities.includes(remediationPriorityInput)
							? remediationPriorityInput
							: "p2",
						dueDate: remediationDueDateInput.trim() || null,
						recommendedFix: remediationFixInput.trim() || null,
					},
				},
			});
			await loadFindingDetails(selectedFindingId, true, true);
			if (selectedScanRunId) {
				setFindings(await fetchScanFindings(selectedScanRunId));
			}
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "修正計画の保存に失敗しました。",
			);
		} finally {
			setRemediationSaveLoading(false);
		}
	};

	const handleTriggerReproduction = async () => {
		if (!selectedFindingId || !selectedReproProfile) return;
		setReproLoading(true);
		setReproError(null);
		try {
			const res = await triggerFindingReproduction(selectedFindingId, {
				profileId: selectedReproProfile,
			});
			if (res.reproductionRunId) await openReproRun(res.reproductionRunId);
			setReproRuns(
				(await fetchFindingReproductions(selectedFindingId)).reproductions,
			);
			if (selectedScanRunId)
				setFindings(await fetchScanFindings(selectedScanRunId));
			findingSelectionCacheRef.current.delete(selectedFindingId);
			findingVerificationCacheRef.current.delete(selectedFindingId);
		} catch (err) {
			setReproError(
				err instanceof Error ? err.message : "再現確認の起動に失敗しました。",
			);
		} finally {
			setReproLoading(false);
		}
	};

	const openReproRun = async (runId: string) => {
		setExpandedReproRunId(runId);
		const res = await fetchReproductionRunArtifacts(runId);
		setReproRunArtifacts((prev) => ({ ...prev, [runId]: res.artifacts }));
		setReproRunEvidence((prev) => ({ ...prev, [runId]: res.evidence }));
	};

	const handleToggleReproRun = async (runId: string) => {
		if (expandedReproRunId === runId) return setExpandedReproRunId(null);
		if (reproRunArtifacts[runId]) return setExpandedReproRunId(runId);
		await openReproRun(runId).catch(console.error);
	};

	const handleTriggerDynamic = async () => {
		if (!selectedFindingId || !selectedDynamicProfile) return;
		const profile = dynamicProfiles.find(
			(item) => item.profileId === selectedDynamicProfile,
		);
		if (profile?.allowProjectScripts && !allowProjectScriptsConsent) {
			setDynamicError(
				"Docker sandbox 内でプロジェクトスクリプトを実行するには明示的な同意が必要です。",
			);
			return;
		}
		setDynamicLoading(true);
		setDynamicError(null);
		try {
			const res = await triggerFindingDynamicRun(selectedFindingId, {
				profileId: selectedDynamicProfile,
			});
			if (res.dynamicRunId) await openDynamicRun(res.dynamicRunId);
			setDynamicRuns(
				(await fetchFindingDynamicRuns(selectedFindingId)).dynamicRuns,
			);
			if (selectedScanRunId)
				setFindings(await fetchScanFindings(selectedScanRunId));
			findingSelectionCacheRef.current.delete(selectedFindingId);
			findingVerificationCacheRef.current.delete(selectedFindingId);
		} catch (err) {
			setDynamicError(
				err instanceof Error ? err.message : "動的検証の起動に失敗しました。",
			);
		} finally {
			setDynamicLoading(false);
		}
	};

	const openDynamicRun = async (runId: string) => {
		setExpandedDynamicRunId(runId);
		const res = await fetchDynamicRunArtifacts(runId);
		setDynamicRunArtifacts((prev) => ({ ...prev, [runId]: res.artifacts }));
		setDynamicRunEvidence((prev) => ({ ...prev, [runId]: res.evidence }));
	};

	const handleToggleDynamicRun = async (runId: string) => {
		if (expandedDynamicRunId === runId) return setExpandedDynamicRunId(null);
		if (dynamicRunArtifacts[runId]) return setExpandedDynamicRunId(runId);
		await openDynamicRun(runId).catch(console.error);
	};

	const {
		selectedProject,
		selectedScanRun,
		selectedCoverageSummary,
		executiveRiskSummary,
		workflowCompletion,
		scanComparison,
		reportQualityPreview,
		diagnosticDashboard,
		actionQueueItems,
		filteredActionQueueItems,
		findingWorkStatesById,
		evidenceQualityByFindingId,
		remediationPlanByFindingId,
		selectedEvidenceQuality,
		selectedRemediationPlan,
		displayedFindings,
	} = useScansDerivedState({
		selectedVerificationDataLoaded,
		selectedFindingId,
		reproductionRuns: reproRuns,
		dynamicRuns,
		findings,
		selectedFindingDetails,
		selectedFindingDastEvidence,
		diagnosticReports,
		findingsViewMode,
		selectedGroupId,
		scanGroups,
		projects,
		selectedProjectId,
		scanRuns,
		selectedScanRunId,
		attackSurfaceItems,
		securityCheckResults,
		scanSummary,
		scanReviews,
		reports,
		actionQueueFilter,
	});
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
	const {
		handleActionQueueItem,
		handleWorkflowNextAction,
		handleCloseFinding,
		handleDashboardAction,
	} = buildScansNavigationHandlers({
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
		runDiagnosticsForScan,
	});

	return {
		active,
		busy,
		projects,
		selectedProject,
		selectedScanRun,
		selectedCoverageSummary,
		executiveRiskSummary,
		workflowCompletion,
		scanComparison,
		reportQualityPreview,
		diagnosticDashboard,
		handleDashboardAction,
		actionQueueFilter,
		setActionQueueFilter,
		actionQueueItems,
		filteredActionQueueItems,
		findingWorkStatesById,
		evidenceQualityByFindingId,
		remediationPlanByFindingId,
		selectedEvidenceQuality,
		selectedRemediationPlan,
		handleActionQueueItem,
		handleWorkflowNextAction,
		selectedProjectId,
		setSelectedProjectId,
		projectFolderPath,
		setProjectFolderPath,
		projectDefaultBranch,
		setProjectDefaultBranch,
		projectCreateLoading,
		projectBrowseLoading,
		showNewProjectModal,
		setShowNewProjectModal,
		handleBrowseProjectFolder,
		handleSelectProjectFolder,
		handleCreateProjectFromFolder,
		scanRuns,
		scanEvents,
		selectedScanRunId,
		setSelectedScanRunId,
		handleSelectScanRun,
		scanListTab,
		setScanListTab,
		scanDetailTab,
		setScanDetailTab,
		findings,
		findingsLoading,
		selectedFindingId,
		setSelectedFindingId,
		handleSelectFinding,
		handleCloseFinding,
		profiles,
		selectedProfileId,
		setSelectedProfileId,
		scanTargetKind,
		handleScanTargetKindChange,
		diffBaseRef,
		setDiffBaseRef,
		diffHeadRef,
		setDiffHeadRef,
		diffIncludeUntracked,
		setDiffIncludeUntracked,
		diffPreview,
		diffPreviewCurrent,
		diffPreviewLoading,
		diffPreviewError,
		handlePreviewDiffTarget,
		continueOnToolFailure,
		setContinueOnToolFailure,
		timeoutSec,
		setTimeoutSec,
		showRunScanForm,
		setShowRunScanForm,
		isScanning,
		scanSummary,
		scanGroups,
		selectedGroupId,
		setSelectedGroupId,
		findingsViewMode,
		setFindingsViewMode,
		selectedFindingDetails,
		selectedDecisionWorkflow,
		allReviews,
		reviewLoading,
		reviewError,
		allDecisions,
		decisionInput,
		setDecisionInput,
		reasonInput,
		setReasonInput,
		commentInput,
		setCommentInput,
		linkReviewInput,
		setLinkReviewInput,
		decisionSubmitLoading,
		remediationStatusInput,
		setRemediationStatusInput,
		remediationOwnerInput,
		setRemediationOwnerInput,
		remediationPriorityInput,
		setRemediationPriorityInput,
		remediationDueDateInput,
		setRemediationDueDateInput,
		remediationFixInput,
		setRemediationFixInput,
		remediationSaveLoading,
		viewingReport,
		setViewingReport,
		reportLoading,
		reportOptions: DEFAULT_REPORT_OPTIONS,
		reports,
		selectedReport,
		setSelectedReport,
		scanReviewLoading,
		scanReviewFindingFilter,
		setScanReviewFindingFilter,
		scanReviews,
		reportPreviewContent,
		attackSurfaceItems,
		securityCheckResults,
		diagnosticReports,
		diagnosticLoading,
		reproProfiles,
		reproRuns,
		selectedReproProfile,
		setSelectedReproProfile,
		reproLoading,
		reproError,
		expandedReproRunId,
		reproRunArtifacts,
		reproRunEvidence,
		dynamicProfiles,
		dynamicRuns,
		selectedDynamicProfile,
		setSelectedDynamicProfile,
		dynamicLoading,
		dynamicError,
		expandedDynamicRunId,
		dynamicRunArtifacts,
		dynamicRunEvidence,
		allowProjectScriptsConsent,
		setAllowProjectScriptsConsent,
		...dast,
		displayedFindings,
		handleStartScanProfile,
		handleCancelScan,
		handleGenerateReport,
		handleTriggerScanReview,
		handleRunDiagnostics,
		handleRunAttackSurfaceInventory,
		handleRunSecurityChecks,
		handleGenerateDiagnosticReport,
		handleTriggerReview,
		handleDecisionSubmit,
		handleRemediationSubmit,
		handleTriggerReproduction,
		handleToggleReproRun,
		handleTriggerDynamic,
		handleToggleDynamicRun,
	};
};
export type ScansController = ReturnType<typeof useScansController>;
