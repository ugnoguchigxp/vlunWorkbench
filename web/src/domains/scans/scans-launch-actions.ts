import {
	browseProjectFolder,
	cancelScan,
	createProject,
	type DynamicProfileConfig,
	type DynamicRun,
	type Finding,
	type FindingDecision,
	type FindingEvidence,
	type FindingReview,
	fetchAutomatedScanDiagnostics,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	fetchScans,
	generateScanReport,
	previewScan,
	retryAutomatedScanDiagnostic,
	type ReproductionProfile,
	type ReproductionRun,
	type ScanTargetKind,
	startScan,
	triggerScanReview,
} from "../../api";
import type {
	RemediationPriority,
	RemediationStatus,
} from "./remediation-plan";

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

export function buildScanLaunchActions(scope: Record<string, any>) {
	const {
		buildSelectedScanTarget,
		continueOnToolFailure,
		diffPreview,
		diffPreviewCurrent,
		diffPreviewInputKey,
		diffPreviewRequestIdRef,
		getReportQualityPreview,
		projectDefaultBranch,
		projectFolderPath,
		projects,
		scanReviewFindingFilter,
		scanTargetKind,
		selectedProfileId,
		selectedProjectId,
		selectedScanRunId,
		setAttackSurfaceItems,
		setAutomatedDiagnosticLoading,
		setAutomatedDiagnostics,
		setDiagnosticReports,
		setDiffBaseRef,
		setDiffHeadRef,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setErrorText,
		setIsScanning,
		setProjectBrowseLoading,
		setProjectCreateLoading,
		setProjectFolderPath,
		setProjects,
		setReportLoading,
		setReports,
		setScanDetailTab,
		setScanListTab,
		setScanReviewLoading,
		setScanReviews,
		setScanRuns,
		setScanTargetKind,
		setSecurityCheckResults,
		setSelectedFindingDetails,
		setSelectedFindingId,
		setSelectedProjectId,
		setSelectedReport,
		setSelectedScanRunId,
		setShowNewProjectModal,
		setShowRunScanForm,
		timeoutSec,
	} = scope;
	const handleScanTargetKindChange = (kind: ScanTargetKind) => {
		setScanTargetKind(kind);
		const project = projects.find(
			(item: { id: string; defaultBranch?: string }) =>
				item.id === selectedProjectId,
		);
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
		const project = projects.find(
			(item: { id: string; pathPolicy?: { status?: string } }) =>
				item.id === selectedProjectId,
		);
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
			setScanRuns((runs: Array<{ id: string }>) =>
				runs.map((item: { id: string }) => (item.id === scan.id ? scan : item)),
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
			setProjects((prev: Array<{ id: string }>) => {
				const others = prev.filter(
					(item: { id: string }) => item.id !== created.id,
				);
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
					? getReportQualityPreview().recommendedReportTitle
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

	const handleRetryAutomatedDiagnostic = async (
		scanRunId = selectedScanRunId,
	) => {
		if (!scanRunId) return;
		setAutomatedDiagnosticLoading(true);
		setErrorText(null);
		try {
			const started = await retryAutomatedScanDiagnostic(scanRunId);
			setAutomatedDiagnostics([started.diagnostic]);
			const deadline = Date.now() + SCAN_REVIEW_WAIT_TIMEOUT_MS;
			while (true) {
				const diagnostics = await fetchAutomatedScanDiagnostics(scanRunId);
				setAutomatedDiagnostics(diagnostics);
				const latest = diagnostics[0];
				if (
					latest?.status === "completed" ||
					latest?.status === "completed_with_limitations"
				) {
					const [nextReports, nextReviews] = await Promise.all([
						fetchScanReports(scanRunId),
						fetchScanReviews(scanRunId),
					]);
					setReports(nextReports);
					setSelectedReport(nextReports[0] ?? null);
					setScanReviews(nextReviews);
					setScanDetailTab(nextReports[0] ? "report" : "review");
					break;
				}
				if (latest?.status === "failed") {
					throw new Error(
						latest.errorMessage ?? "自動診断の再実行に失敗しました。",
					);
				}
				if (Date.now() >= deadline) {
					throw new Error(
						"自動診断の完了待機がタイムアウトしました。診断状態から進行状況を確認してください。",
					);
				}
				await wait(SCAN_REVIEW_POLL_INTERVAL_MS);
			}
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "自動診断の再実行に失敗しました。",
			);
		} finally {
			setAutomatedDiagnosticLoading(false);
		}
	};

	return {
		handleBrowseProjectFolder,
		handleCancelScan,
		handleCreateProjectFromFolder,
		handleGenerateReport,
		handleRetryAutomatedDiagnostic,
		handlePreviewDiffTarget,
		handleScanTargetKindChange,
		handleSelectProjectFolder,
		handleStartScanProfile,
		handleTriggerScanReview,
		reloadDiagnostics,
	};
}
