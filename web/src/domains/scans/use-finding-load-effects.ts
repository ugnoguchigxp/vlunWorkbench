import { useCallback, useEffect } from "react";
import {
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingReview,
	fetchFinding,
	fetchFindingDecisions,
	fetchFindingDynamicRuns,
	fetchFindingReproductions,
	fetchFindingReviews,
	fetchProjectDynamicProfiles,
	fetchReproductionProfiles,
	type ReproductionProfile,
	type ReproductionRun,
	type ScanTarget,
} from "../../api";
import type {
	RemediationPriority,
	RemediationStatus,
} from "./remediation-plan";

const _DEFAULT_REPORT_OPTIONS = {
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

export function useFindingLoadEffects(scope: Record<string, any>) {
	const {
		active,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
		diffPreview,
		diffPreviewRequestIdRef,
		diffPreviewResolvedInputKey,
		findingLoadInFlightRef,
		findingSelectionCacheRef,
		findingVerificationCacheRef,
		findingVerificationInFlightRef,
		linkReviewDefaultFindingRef,
		profiles,
		reports,
		requestedProjectId,
		requestedScanRunId,
		runWithBusy,
		scanDetailTab,
		scanTargetKind,
		selectedDecisionWorkflow,
		selectedFindingDetails,
		selectedFindingId,
		selectedFindingIdRef,
		selectedPollingStatus,
		selectedProfileId,
		selectedProjectId,
		selectedReport,
		selectedScanRunId,
		setAllDecisions,
		setAllReviews,
		setAttackSurfaceItems,
		setCommentInput,
		setDecisionInput,
		setDiagnosticReports,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setDynamicProfiles,
		setDynamicRuns,
		setErrorText,
		setFindings,
		setFindingsLoading,
		setLinkReviewInput,
		setProfiles,
		setProjects,
		setReasonInput,
		setRemediationDueDateInput,
		setRemediationFixInput,
		setRemediationOwnerInput,
		setRemediationPriorityInput,
		setRemediationStatusInput,
		setReportPreviewContent,
		setReports,
		setReproProfiles,
		setReproRuns,
		setReviewError,
		setScanDetailTab,
		setScanEvents,
		setScanGroups,
		setScanReviews,
		setScanRuns,
		setScanSummary,
		setScanTargetKind,
		setSecurityCheckResults,
		setSelectedDynamicProfile,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedGroupId,
		setSelectedProjectId,
		setSelectedReport,
		setSelectedReproProfile,
		setSelectedScanRunId,
		setVerificationDataLoadedFindingId,
	} = scope;
	const applyFindingSelectionBundle = useCallback(
		(findingId: string, bundle: FindingSelectionBundle) => {
			if (selectedFindingIdRef.current !== findingId) return;
			setSelectedFindingDetails(bundle.details);
			setAllReviews(bundle.reviews);
			setAllDecisions(bundle.decisions);
		},
		[
			setSelectedFindingDetails,
			setAllReviews,
			setAllDecisions,
			selectedFindingIdRef.current,
		],
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
		[
			setReproRuns,
			setVerificationDataLoadedFindingId,
			setReproProfiles,
			setSelectedDynamicProfile,
			setSelectedReproProfile,
			setDynamicRuns,
			setDynamicProfiles,
			selectedFindingIdRef.current,
		],
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
		[
			applyFindingSelectionBundle,
			runWithBusy,
			findingSelectionCacheRef.current.get,
			findingSelectionCacheRef.current.set,
			findingLoadInFlightRef.current.set,
			findingLoadInFlightRef.current.get,
			findingLoadInFlightRef.current.delete,
		],
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
		[
			applyFindingVerificationBundle,
			findingVerificationInFlightRef.current.delete,
			findingSelectionCacheRef.current.get,
			findingVerificationInFlightRef.current.get,
			findingVerificationInFlightRef.current.set,
			findingVerificationCacheRef.current.set,
			findingVerificationCacheRef.current.get,
			findingLoadInFlightRef.current.get,
		],
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
	}, [
		active,
		selectedFindingId,
		loadFindingDetails,
		setSelectedReproProfile,
		setAllDecisions,
		setSelectedFindingDetails,
		setSelectedDynamicProfile,
		setAllReviews,
		setReproProfiles,
		setDynamicRuns,
		setReproRuns,
		setVerificationDataLoadedFindingId,
		setDynamicProfiles,
	]);

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
	}, [
		active,
		selectedFindingId,
		selectedFindingDetails?.latestReview?.status,
		setSelectedFindingDetails,
		setAllReviews,
	]);

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

	return { buildSelectedScanTarget, loadFindingDetails };
}
