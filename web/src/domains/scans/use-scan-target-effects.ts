import { useEffect, useRef } from "react";
import {
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingReview,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanGroups,
	fetchScanProfiles,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	fetchScanSummary,
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

export function useScanTargetEffects(scope: Record<string, any>) {
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
	useEffect(() => {
		if (!active) return;
		void fetchScanProfiles().then(setProfiles).catch(console.error);
	}, [active, setProfiles]);

	useEffect(() => {
		const profile = profiles.find(
			(item: { id: string; supportedTargets?: ScanTarget["kind"][] }) =>
				item.id === selectedProfileId,
		);
		if (!profile) return;
		const supported = profile.supportedTargets ?? ["full"];
		if (supported.includes(scanTargetKind)) return;
		const nextKind = supported.includes("full")
			? "full"
			: supported.includes("working_tree")
				? "working_tree"
				: supported[0];
		if (nextKind) setScanTargetKind(nextKind);
	}, [profiles, scanTargetKind, selectedProfileId, setScanTargetKind]);

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
	}, [
		diffPreviewInputKey,
		setDiffPreviewError,
		setDiffPreviewLoading,
		diffPreviewRequestIdRef,
		setDiffPreview,
		setDiffPreviewResolvedInputKey,
	]);

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
	}, [
		active,
		selectedScanRunId,
		setSelectedGroupId,
		setScanSummary,
		setScanGroups,
	]);

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
	}, [
		active,
		selectedScanRunId,
		setSelectedReport,
		setReportPreviewContent,
		setScanReviews,
		setAttackSurfaceItems,
		setReports,
		setDiagnosticReports,
		setSecurityCheckResults,
	]);

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
	}, [active, scanDetailTab, selectedReport, setReportPreviewContent]);

	return { diffPreviewCurrent, diffPreviewInputKey };
}
