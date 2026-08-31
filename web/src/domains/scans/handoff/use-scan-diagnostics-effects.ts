import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import {
	fetchAutomatedScanDiagnostics,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	type ScanReport,
	type ScanReview,
	type ScanRun,
} from "../../../api";
import type { ScanDiagnosticsState } from "./use-scan-diagnostics-state";

type ScanDiagnosticsEffectsScope = ScanDiagnosticsState & {
	active: boolean;
	scanRuns: ScanRun[];
	selectedScanRunId: string;
	setErrorText: (text: string | null) => void;
	setReports: Dispatch<SetStateAction<ScanReport[]>>;
	setSelectedReport: Dispatch<SetStateAction<ScanReport | null>>;
};

export const IMPROVEMENT_REQUEST_POLL_INTERVAL_MS = 30_000;
export const IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS = 30 * 60_000;

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function useScanDiagnosticsEffects(scope: ScanDiagnosticsEffectsScope) {
	const {
		active,
		automatedDiagnostics,
		scanReviews,
		scanRuns,
		selectedScanRunId,
		setAttackSurfaceItems,
		setAutomatedDiagnostics,
		setDiagnosticReports,
		setErrorText,
		setReports,
		setScanReviews,
		setSecurityCheckResults,
		setSelectedReport,
	} = scope;

	useEffect(() => {
		if (!active || !selectedScanRunId) {
			setScanReviews([]);
			setAutomatedDiagnostics([]);
			setAttackSurfaceItems([]);
			setSecurityCheckResults([]);
			setDiagnosticReports([]);
			return;
		}
		let mounted = true;
		void fetchScanReviews(selectedScanRunId)
			.then((reviews) => {
				if (mounted) setScanReviews(reviews);
			})
			.catch(() => {
				if (mounted) setScanReviews([]);
			});
		void fetchAutomatedScanDiagnostics(selectedScanRunId)
			.then((diagnostics) => {
				if (mounted) setAutomatedDiagnostics(diagnostics);
			})
			.catch(() => {
				if (mounted) setAutomatedDiagnostics([]);
			});
		void fetchScanAttackSurface(selectedScanRunId)
			.then(({ items }) => {
				if (mounted) setAttackSurfaceItems(items);
			})
			.catch(() => {
				if (mounted) setAttackSurfaceItems([]);
			});
		void fetchScanSecurityChecks(selectedScanRunId)
			.then(({ results }) => {
				if (mounted) setSecurityCheckResults(results);
			})
			.catch(() => {
				if (mounted) setSecurityCheckResults([]);
			});
		void fetchScanDiagnosticReports(selectedScanRunId)
			.then(({ reports }) => {
				if (mounted) setDiagnosticReports(reports);
			})
			.catch(() => {
				if (mounted) setDiagnosticReports([]);
			});
		return () => {
			mounted = false;
		};
	}, [
		active,
		selectedScanRunId,
		setScanReviews,
		setAutomatedDiagnostics,
		setAttackSurfaceItems,
		setDiagnosticReports,
		setSecurityCheckResults,
	]);

	const selectedScan = scanRuns.find(
		(scan: { id: string }) => scan.id === selectedScanRunId,
	);
	const automatedDiagnosticStatus = automatedDiagnostics[0]?.status;
	const runningImprovementRequest = scanReviews.find(
		(review: ScanReview) =>
			review.status === "running" &&
			review.inputBundle?.generationKind === "improvement_request",
	);
	const runningImprovementRequestId = runningImprovementRequest?.id ?? null;
	const automatedDiagnosticTerminal =
		automatedDiagnosticStatus === "completed" ||
		automatedDiagnosticStatus === "completed_with_limitations" ||
		automatedDiagnosticStatus === "failed";
	const automaticDiagnosticExpected =
		selectedScan?.status === "completed" &&
		selectedScan.metadata?.automaticDiagnosticRequested === true;
	useEffect(() => {
		if (
			!active ||
			!selectedScanRunId ||
			!automaticDiagnosticExpected ||
			automatedDiagnosticTerminal
		) {
			return;
		}
		let mounted = true;
		let polling = false;
		const poll = async () => {
			if (polling) return;
			polling = true;
			try {
				const diagnostics =
					await fetchAutomatedScanDiagnostics(selectedScanRunId);
				if (!mounted) return;
				setAutomatedDiagnostics(diagnostics);
				const terminal =
					diagnostics[0]?.status === "completed" ||
					diagnostics[0]?.status === "completed_with_limitations" ||
					diagnostics[0]?.status === "failed";
				if (terminal) {
					const [nextReports, nextReviews] = await Promise.all([
						fetchScanReports(selectedScanRunId),
						fetchScanReviews(selectedScanRunId),
					]);
					if (!mounted) return;
					setReports(nextReports);
					setSelectedReport(nextReports[0] ?? null);
					setScanReviews(nextReviews);
				}
			} finally {
				polling = false;
			}
		};
		void poll().catch(() => undefined);
		const timer = globalThis.setInterval(
			() => void poll().catch(() => undefined),
			1_500,
		);
		return () => {
			mounted = false;
			globalThis.clearInterval(timer);
		};
	}, [
		active,
		automaticDiagnosticExpected,
		automatedDiagnosticTerminal,
		selectedScanRunId,
		setAutomatedDiagnostics,
		setReports,
		setScanReviews,
		setSelectedReport,
	]);

	useEffect(() => {
		if (!active || !selectedScanRunId || !runningImprovementRequestId) return;
		let mounted = true;
		let polling = false;
		let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
		let requestController: AbortController | null = null;
		const startedAt = Date.now();

		const schedule = () => {
			if (!mounted || document.visibilityState === "hidden") return;
			timer = globalThis.setTimeout(
				() => void poll(),
				IMPROVEMENT_REQUEST_POLL_INTERVAL_MS,
			);
		};
		const poll = async () => {
			if (!mounted || polling || document.visibilityState === "hidden") return;
			polling = true;
			requestController = new AbortController();
			try {
				const reviews = await fetchScanReviews(
					selectedScanRunId,
					requestController.signal,
				);
				if (!mounted) return;
				setScanReviews(reviews);
				const current = reviews.find(
					(review) => review.id === runningImprovementRequestId,
				);
				if (!current) {
					setErrorText(
						"改修依頼指示書の生成状態を確認できなくなりました。画面を再読み込みしてください。",
					);
					return;
				}
				if (current.status !== "running") return;
				if (Date.now() - startedAt >= IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS) {
					setErrorText(
						"改修依頼指示書の状態確認を30分で停止しました。画面を再読み込みして生成状態を確認してください。",
					);
					return;
				}
			} catch (error) {
				if (!mounted || isAbortError(error)) return;
				if (Date.now() - startedAt >= IMPROVEMENT_REQUEST_POLL_TIMEOUT_MS) {
					setErrorText(
						"改修依頼指示書の状態確認を30分で停止しました。通信状態を確認して画面を再読み込みしてください。",
					);
					return;
				}
			} finally {
				polling = false;
				requestController = null;
			}
			schedule();
		};
		const handleVisibilityChange = () => {
			if (!mounted || document.visibilityState !== "visible") return;
			if (timer) globalThis.clearTimeout(timer);
			timer = null;
			void poll();
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		schedule();
		return () => {
			mounted = false;
			if (timer) globalThis.clearTimeout(timer);
			requestController?.abort();
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [
		active,
		runningImprovementRequestId,
		selectedScanRunId,
		setErrorText,
		setScanReviews,
	]);
}
