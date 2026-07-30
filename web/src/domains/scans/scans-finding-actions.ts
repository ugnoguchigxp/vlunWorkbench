import type { FormEvent } from "react";
import {
	createFindingDecision,
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingReview,
	fetchDynamicRunArtifacts,
	fetchFindingDynamicRuns,
	fetchFindingReproductions,
	fetchReproductionRunArtifacts,
	fetchScanFindings,
	generateDiagnosticReport,
	type ReproductionProfile,
	type ReproductionRun,
	runScanAttackSurfaceInventory,
	runScanSecurityChecks,
	triggerFindingDynamicRun,
	triggerFindingReproduction,
	triggerFindingReview,
} from "../../api";
import type {
	RemediationPriority,
	RemediationStatus,
} from "./remediation-plan";
import { useScansDerivedState } from "./scans-derived-controller";

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

export function useScansFindingActions(scope: Record<string, any>) {
	const {
		actionQueueFilter,
		allowProjectScriptsConsent,
		attackSurfaceItems,
		commentInput,
		decisionInput,
		diagnosticReports,
		dynamicProfiles,
		dynamicRunArtifacts,
		dynamicRuns,
		expandedDynamicRunId,
		expandedReproRunId,
		findingSelectionCacheRef,
		findingVerificationCacheRef,
		findings,
		findingsViewMode,
		linkReviewInput,
		loadFindingDetails,
		projects,
		reasonInput,
		reloadDiagnostics,
		remediationDueDateInput,
		remediationFixInput,
		remediationOwnerInput,
		remediationPriorityInput,
		remediationStatusInput,
		reports,
		reproRunArtifacts,
		reproRuns,
		scanGroups,
		scanReviews,
		scanRuns,
		scanSummary,
		securityCheckResults,
		selectedDynamicProfile,
		selectedFindingDastEvidence,
		selectedFindingDetails,
		selectedFindingId,
		selectedGroupId,
		selectedProjectId,
		selectedReproProfile,
		selectedScanRunId,
		selectedVerificationDataLoaded,
		setCommentInput,
		setDecisionSubmitLoading,
		setDiagnosticLoading,
		setDynamicError,
		setDynamicLoading,
		setDynamicRunArtifacts,
		setDynamicRunEvidence,
		setDynamicRuns,
		setErrorText,
		setExpandedDynamicRunId,
		setExpandedReproRunId,
		setFindings,
		setRemediationSaveLoading,
		setReproError,
		setReproLoading,
		setReproRunArtifacts,
		setReproRunEvidence,
		setReproRuns,
		setReviewError,
		setReviewLoading,
	} = scope;
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
		setReproRunArtifacts((prev: Record<string, typeof res.artifacts>) => ({
			...prev,
			[runId]: res.artifacts,
		}));
		setReproRunEvidence((prev: Record<string, typeof res.evidence>) => ({
			...prev,
			[runId]: res.evidence,
		}));
	};

	const handleToggleReproRun = async (runId: string) => {
		if (expandedReproRunId === runId) return setExpandedReproRunId(null);
		if (reproRunArtifacts[runId]) return setExpandedReproRunId(runId);
		await openReproRun(runId).catch(console.error);
	};

	const handleTriggerDynamic = async () => {
		if (!selectedFindingId || !selectedDynamicProfile) return;
		const profile = dynamicProfiles.find(
			(item: { profileId: string; allowProjectScripts?: boolean }) =>
				item.profileId === selectedDynamicProfile,
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
		setDynamicRunArtifacts((prev: Record<string, typeof res.artifacts>) => ({
			...prev,
			[runId]: res.artifacts,
		}));
		setDynamicRunEvidence((prev: Record<string, typeof res.evidence>) => ({
			...prev,
			[runId]: res.evidence,
		}));
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
	return {
		actionQueueItems,
		diagnosticDashboard,
		displayedFindings,
		evidenceQualityByFindingId,
		executiveRiskSummary,
		filteredActionQueueItems,
		findingWorkStatesById,
		handleDecisionSubmit,
		handleGenerateDiagnosticReport,
		handleRemediationSubmit,
		handleRunAttackSurfaceInventory,
		handleRunDiagnostics,
		handleRunSecurityChecks,
		handleToggleDynamicRun,
		handleToggleReproRun,
		handleTriggerDynamic,
		handleTriggerReproduction,
		handleTriggerReview,
		remediationPlanByFindingId,
		reportQualityPreview,
		runDiagnosticsForScan,
		scanComparison,
		selectedCoverageSummary,
		selectedEvidenceQuality,
		selectedProject,
		selectedRemediationPlan,
		selectedScanRun,
		workflowCompletion,
	};
}
