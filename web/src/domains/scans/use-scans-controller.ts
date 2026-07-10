import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
	type AttackSurfaceItem,
	browseProjectFolder,
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
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
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
	type ReproductionArtifact,
	type ReproductionEvidence,
	type ReproductionProfile,
	type ReproductionRun,
	type ScanReviewFindingFilter,
	runScanAttackSurfaceInventory,
	runScanSecurityChecks,
	type ScanProfile,
	type ScanReport,
	type ScanReview,
	type ScanRun,
	type ScanRunSummary,
	type SecurityCheckResult,
	startScan,
	triggerFindingDynamicRun,
	triggerFindingReproduction,
	triggerFindingReview,
	triggerScanReview,
} from "../../api";
import { buildCoverageSummary } from "./coverage-summary";
import { buildDecisionGradeView } from "./decision-grade-view";
import { buildDecisionWorkflow } from "./decision-workflow";
import {
	buildProjectDiagnosticDashboard,
	type DashboardAction,
} from "./diagnostic-dashboard";
import { buildEvidenceQuality } from "./evidence-quality";
import {
	buildRemediationPlanView,
	type RemediationPriority,
	type RemediationStatus,
	readRemediationMetadata,
} from "./remediation-plan";
import { useDastController } from "./use-dast-controller";
import {
	type ActionQueueItem,
	buildActionQueue,
	deriveFindingWorkState,
	type FindingWorkState,
} from "./work-states";

const DEFAULT_REPORT_OPTIONS = {
	includeFalsePositives: true,
	includeDeferred: true,
	includeUndecided: true,
};

const basenameFromPath = (value: string): string => {
	const normalized = value.replace(/\/+$/, "");
	const parts = normalized.split("/");
	return parts.at(-1) || normalized || "ローカルプロジェクト";
};

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
	const [projectNameInput, setProjectNameInput] = useState("");
	const [projectDefaultBranch, setProjectDefaultBranch] = useState("main");
	const [projectCreateLoading, setProjectCreateLoading] = useState(false);
	const [projectBrowseLoading, setProjectBrowseLoading] = useState(false);
	const [showNewProjectModal, setShowNewProjectModal] = useState(false);
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
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
	const [baselineFindings, setBaselineFindings] = useState<Finding[] | null>(
		null,
	);
	const [baselineScanRunId, setBaselineScanRunId] = useState<string | null>(
		null,
	);
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

	const handleStartScanProfile = async () => {
		if (!selectedProjectId || !selectedProfileId || timeoutSec <= 0) return;
		setIsScanning(true);
		setErrorText(null);
		try {
			const res = await startScan(selectedProjectId, {
				profile: selectedProfileId,
				continueOnToolFailure: true,
				timeoutSec,
			});
			setScanRuns(await fetchScans(selectedProjectId));
			if (res.scan?.id) {
				setSelectedScanRunId(res.scan.id);
				setSelectedFindingId("");
				setSelectedFindingDetails(null);
				setScanListTab("runs");
				setScanDetailTab("review");
			}
			setShowRunScanForm(false);
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "scan の実行に失敗しました。",
			);
		} finally {
			setIsScanning(false);
		}
	};

	const handleSelectProjectFolder = (path: string) => {
		setProjectFolderPath(path);
		if (!projectNameInput.trim()) {
			setProjectNameInput(basenameFromPath(path));
		}
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
		const name = projectNameInput.trim() || basenameFromPath(repoPath);
		if (!repoPath || !name) return;

		setProjectCreateLoading(true);
		setErrorText(null);
		try {
			const created = await createProject({
				name,
				repoPath,
				defaultBranch: projectDefaultBranch.trim() || "main",
			});
			setProjects((prev) => {
				const others = prev.filter((item) => item.id !== created.id);
				return [created, ...others];
			});
			setSelectedProjectId(created.id);
			setProjectFolderPath(created.repoPath);
			setProjectNameInput(created.name);
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
			await triggerScanReview(scanRunId, {
				findingFilter: scanReviewFindingFilter,
			});
			setScanReviews(await fetchScanReviews(scanRunId));
			setScanDetailTab("review");
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

	const verificationByFindingId = useMemo(() => {
		const map = new Map<
			string,
			{ reproductionRuns?: ReproductionRun[]; dynamicRuns?: DynamicRun[] }
		>();
		if (selectedVerificationDataLoaded && selectedFindingId) {
			map.set(selectedFindingId, {
				reproductionRuns: reproRuns,
				dynamicRuns,
			});
		}
		return map;
	}, [
		selectedVerificationDataLoaded,
		selectedFindingId,
		reproRuns,
		dynamicRuns,
	]);
	const findingWorkStatesById = useMemo(() => {
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
	}, [findings, verificationByFindingId]);
	const evidenceQualityByFindingId = useMemo(() => {
		const map = new Map<string, ReturnType<typeof buildEvidenceQuality>>();
		for (const finding of findings) {
			const isSelected = finding.id === selectedFindingId;
			const verification = verificationByFindingId.get(finding.id);
			const details =
				isSelected && selectedFindingDetails?.finding.id === finding.id
					? selectedFindingDetails
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
					dastEvidence: isSelected ? selectedFindingDastEvidence : undefined,
					diagnosticReports,
					dataCompleteness: {
						hasFindingDetails: Boolean(details),
						hasVerificationData: Boolean(
							verification?.reproductionRuns?.length ||
								verification?.dynamicRuns?.length,
						),
						hasDastEvidenceLoaded:
							isSelected && (selectedFindingDastEvidence?.length ?? 0) > 0,
					},
				}),
			);
		}
		return map;
	}, [
		findings,
		selectedFindingId,
		selectedFindingDetails,
		verificationByFindingId,
		selectedFindingDastEvidence,
		diagnosticReports,
	]);
	const remediationPlanByFindingId = useMemo(() => {
		const map = new Map<string, ReturnType<typeof buildRemediationPlanView>>();
		for (const finding of findings) {
			const isSelected = finding.id === selectedFindingId;
			const verification = verificationByFindingId.get(finding.id);
			const details =
				isSelected && selectedFindingDetails?.finding.id === finding.id
					? selectedFindingDetails
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
	}, [
		findings,
		selectedFindingId,
		selectedFindingDetails,
		verificationByFindingId,
	]);
	const selectedEvidenceQuality = selectedFindingId
		? (evidenceQualityByFindingId.get(selectedFindingId) ?? null)
		: null;
	const selectedRemediationPlan = selectedFindingId
		? (remediationPlanByFindingId.get(selectedFindingId) ?? null)
		: null;
	const displayedFindings = useMemo(() => {
		const base =
			findingsViewMode === "grouped" && selectedGroupId
				? findings.filter((item) =>
						scanGroups
							.find((group) => group.id === selectedGroupId)
							?.findingIds.includes(item.id),
					)
				: findings;
		if (findingsViewMode === "grouped") return base;
		return [...base].sort((a, b) => {
			const stateDelta =
				workStateRank[findingWorkStatesById.get(a.id) ?? "ready_for_report"] -
				workStateRank[findingWorkStatesById.get(b.id) ?? "ready_for_report"];
			if (stateDelta !== 0) return stateDelta;
			const severityDelta = severityRank[a.severity] - severityRank[b.severity];
			if (severityDelta !== 0) return severityDelta;
			const aTime = new Date(a.updatedAt).getTime();
			const bTime = new Date(b.updatedAt).getTime();
			if (aTime !== bTime) return bTime - aTime;
			return a.title.localeCompare(b.title);
		});
	}, [
		findings,
		findingsViewMode,
		findingWorkStatesById,
		scanGroups,
		selectedGroupId,
	]);
	const selectedProject =
		projects.find((project) => project.id === selectedProjectId) ?? null;
	const selectedScanRun =
		scanRuns.find((run) => run.id === selectedScanRunId) ?? null;
	const baselineScanRun = useMemo(() => {
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
					(a, b) =>
						new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
				)[0] ?? null
		);
	}, [scanRuns, selectedScanRun]);
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
				findings,
				attackSurfaceItems,
				securityCheckResults,
				diagnosticReports,
				scanSummary,
			}),
		[
			selectedScanRun,
			findings,
			attackSurfaceItems,
			securityCheckResults,
			diagnosticReports,
			scanSummary,
		],
	);
	const decisionGradeView = useMemo(
		() =>
			buildDecisionGradeView({
				selectedScanRunId,
				selectedScanRun,
				findings,
				scanReviews,
				evidenceQualityByFindingId,
				remediationPlanByFindingId,
				reports,
				diagnosticReports,
				selectedCoverageSummary,
				baselineScanRunId,
				baselineFindings,
			}),
		[
			selectedScanRunId,
			selectedScanRun,
			findings,
			scanReviews,
			evidenceQualityByFindingId,
			remediationPlanByFindingId,
			reports,
			diagnosticReports,
			selectedCoverageSummary,
			baselineScanRunId,
			baselineFindings,
		],
	);
	const {
		executiveRiskSummary,
		workflowCompletion,
		scanComparison,
		reportQualityPreview,
	} = decisionGradeView;
	const diagnosticDashboard = useMemo(
		() =>
			buildProjectDiagnosticDashboard({
				projectId: selectedProjectId,
				scanRuns,
				selectedScanRunId,
				findings,
				reports,
				scanReviews,
				diagnosticReports,
				securityCheckResults,
				attackSurfaceItems,
				scanSummary,
			}),
		[
			selectedProjectId,
			scanRuns,
			selectedScanRunId,
			findings,
			reports,
			scanReviews,
			diagnosticReports,
			securityCheckResults,
			attackSurfaceItems,
			scanSummary,
		],
	);
	const actionQueueItems = useMemo(
		() =>
			buildActionQueue({
				scanRuns,
				selectedScanRunId,
				findings,
				reports,
				diagnosticReports,
				scanSummary,
				verificationByFindingId,
			}),
		[
			scanRuns,
			selectedScanRunId,
			findings,
			reports,
			diagnosticReports,
			scanSummary,
			verificationByFindingId,
		],
	);
	const filteredActionQueueItems = useMemo(
		() =>
			actionQueueItems.filter((item) => {
				if (actionQueueFilter === "all") return true;
				if (actionQueueFilter === "active")
					return item.state !== "report_generated";
				return item.state === actionQueueFilter;
			}),
		[actionQueueFilter, actionQueueItems],
	);
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
	const handleActionQueueItem = (item: ActionQueueItem) => {
		if (item.targetType === "finding") {
			const targetFinding = findings.find(
				(finding) => finding.id === item.targetId,
			);
			if (targetFinding && targetFinding.scanRunId !== selectedScanRunId) {
				handleSelectScanRun(targetFinding.scanRunId);
			}
			setScanListTab("findings");
			handleSelectFinding(item.targetId);
			setScanDetailTab(
				item.state === "needs_verification" ? "verification" : "review",
			);
			return;
		}

		if (item.targetType === "scan") {
			handleSelectScanRun(item.targetId);
			setScanListTab("runs");
			return;
		}

		if (item.targetType === "report") {
			if (item.targetId !== selectedScanRunId)
				handleSelectScanRun(item.targetId);
			setScanDetailTab("report");
			return;
		}

		if (item.targetType === "diagnostic") {
			if (item.targetId !== selectedScanRunId)
				handleSelectScanRun(item.targetId);
			setScanListTab("runs");
			setScanDetailTab("review");
		}
	};
	const handleWorkflowNextAction = () => {
		const action = workflowCompletion.nextBestAction;
		if (!action) return;
		if (
			action.action === "review_findings" ||
			action.action === "run_verification" ||
			action.action === "create_remediation_plan"
		) {
			const targetFinding =
				findings.find((finding) => finding.id === action.targetId) ??
				findings[0];
			if (targetFinding) {
				setScanListTab("findings");
				handleSelectFinding(targetFinding.id);
				setScanDetailTab(
					action.action === "run_verification" ? "verification" : "review",
				);
			}
			return;
		}
		if (action.action === "create_improvement_request") {
			void handleTriggerScanReview(action.targetId);
			return;
		}
		if (action.action === "generate_report") {
			void handleGenerateReport("deterministic", action.targetId);
			return;
		}
		if (action.action === "inspect_coverage") {
			setScanListTab("runs");
			setScanDetailTab("review");
		}
	};
	const handleCloseFinding = () => {
		selectedFindingIdRef.current = "";
		setSelectedFindingId("");
		setSelectedFindingDetails(null);
		setReviewError(null);
		setScanDetailTab("review");
	};
	const handleDashboardAction = (action: DashboardAction) => {
		if (action.kind === "run_scan") {
			setScanListTab("runs");
			return;
		}

		if (action.kind === "create_improvement_request") {
			if (action.targetId) handleSelectScanRun(action.targetId);
			void handleTriggerScanReview(action.targetId);
			return;
		}

		if (action.kind === "review_findings") {
			setScanListTab("findings");
			const targetFinding =
				findings.find((finding) => finding.id === action.targetId) ??
				findings[0];
			if (targetFinding) handleSelectFinding(targetFinding.id);
			return;
		}

		if (action.kind === "inspect_zero_findings") {
			if (action.targetId) handleSelectScanRun(action.targetId);
			setScanDetailTab("review");
			return;
		}

		if (action.kind === "run_diagnostics") {
			const targetScanRunId = action.targetId ?? selectedScanRunId;
			if (targetScanRunId && targetScanRunId !== selectedScanRunId) {
				handleSelectScanRun(targetScanRunId);
			}
			if (targetScanRunId) void runDiagnosticsForScan(targetScanRunId);
			return;
		}

		if (action.kind === "generate_report") {
			const targetScanRunId = action.targetId ?? selectedScanRunId;
			if (targetScanRunId && targetScanRunId !== selectedScanRunId) {
				handleSelectScanRun(targetScanRunId);
			}
			void handleGenerateReport("deterministic", targetScanRunId);
		}
	};

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
		projectNameInput,
		setProjectNameInput,
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
