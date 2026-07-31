import { useEffect, useRef } from "react";
import {
	fetchAutomatedScanDiagnostics,
	fetchScanAttackSurface,
	fetchScanDiagnosticReports,
	fetchScanGroups,
	fetchScanProfiles,
	fetchScanReports,
	fetchScanReviews,
	fetchScanSecurityChecks,
	fetchScanSummary,
	type ScanTarget,
} from "../../api";
import type { ScansControllerBaseScope } from "./use-scans-base-controller";

export function useScanTargetEffects(scope: ScansControllerBaseScope) {
	const {
		active,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
		diffPreview,
		diffPreviewRequestIdRef,
		diffPreviewResolvedInputKey,
		profiles,
		automatedDiagnostics,
		scanDetailTab,
		scanTargetKind,
		scanRuns,
		selectedProfileId,
		selectedProjectId,
		selectedReport,
		selectedScanRunId,
		setAttackSurfaceItems,
		setAutomatedDiagnostics,
		setDiagnosticReports,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setProfiles,
		setReportPreviewContent,
		setReports,
		setScanGroups,
		setScanReviews,
		setScanSummary,
		setScanTargetKind,
		setSecurityCheckResults,
		setSelectedGroupId,
		setSelectedReport,
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
			setAutomatedDiagnostics([]);
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
		void fetchAutomatedScanDiagnostics(selectedScanRunId)
			.then(setAutomatedDiagnostics)
			.catch(() => setAutomatedDiagnostics([]));
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
		setAutomatedDiagnostics,
		setAttackSurfaceItems,
		setReports,
		setDiagnosticReports,
		setSecurityCheckResults,
	]);

	const selectedScan = scanRuns.find(
		(scan: { id: string }) => scan.id === selectedScanRunId,
	);
	const automatedDiagnosticStatus = automatedDiagnostics[0]?.status;
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
