import {
	fetchAutomatedScanDiagnostics,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	retryAutomatedScanDiagnostic,
	triggerScanImprovementRequest,
	triggerScanReview,
} from "../../../api";
import type { ScansActionScope } from "../workspace/scans-action-scope";

const SCAN_REVIEW_POLL_INTERVAL_MS = 1_500;
const SCAN_REVIEW_WAIT_TIMEOUT_MS = 630_000;

const wait = (durationMs: number) =>
	new Promise<void>((resolve) => globalThis.setTimeout(resolve, durationMs));

export function buildScanHandoffActions(scope: ScansActionScope) {
	const {
		scanReviewFindingFilter,
		selectedScanRunId,
		setAttackSurfaceItems,
		setAutomatedDiagnosticLoading,
		setAutomatedDiagnostics,
		setDiagnosticReports,
		setErrorText,
		setImprovementRequestLoading,
		setReports,
		setScanDetailTab,
		setScanReviewLoading,
		setScanReviews,
		setSecurityCheckResults,
		setSelectedReport,
	} = scope;

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

	const handleGenerateImprovementRequest = async (
		scanRunId = selectedScanRunId,
	) => {
		if (!scanRunId) return;
		setImprovementRequestLoading(true);
		setErrorText(null);
		try {
			const started = await triggerScanImprovementRequest(scanRunId);
			if (!started.result.ok) {
				const reviews = await fetchScanReviews(scanRunId).catch(() => null);
				if (reviews) setScanReviews(reviews);
				throw new Error(
					started.result.error ?? "改修依頼指示書を開始できませんでした。",
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
						review.errorMessage ?? "改修依頼指示書の生成に失敗しました。",
					);
				}
				if (Date.now() >= deadline) {
					throw new Error(
						"改修依頼指示書の完了待機がタイムアウトしました。生成状態を確認してください。",
					);
				}
				await wait(SCAN_REVIEW_POLL_INTERVAL_MS);
			}
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "改修依頼指示書の生成に失敗しました。",
			);
		} finally {
			setImprovementRequestLoading(false);
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
		handleGenerateImprovementRequest,
		handleRetryAutomatedDiagnostic,
		handleTriggerScanReview,
		reloadDiagnostics,
	};
}
