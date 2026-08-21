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
	setReports: Dispatch<SetStateAction<ScanReport[]>>;
	setSelectedReport: Dispatch<SetStateAction<ScanReport | null>>;
};

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
		if (!active || !selectedScanRunId || !runningImprovementRequest) return;
		let mounted = true;
		let polling = false;
		const poll = async () => {
			if (polling) return;
			polling = true;
			try {
				const reviews = await fetchScanReviews(selectedScanRunId);
				if (mounted) setScanReviews(reviews);
			} finally {
				polling = false;
			}
		};
		const timer = globalThis.setInterval(
			() => void poll().catch(() => undefined),
			1_500,
		);
		return () => {
			mounted = false;
			globalThis.clearInterval(timer);
		};
	}, [active, runningImprovementRequest, selectedScanRunId, setScanReviews]);
}
