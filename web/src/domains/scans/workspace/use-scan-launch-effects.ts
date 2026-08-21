import { useEffect, useRef } from "react";
import {
	fetchProjects,
	fetchScanEvents,
	fetchScanProfiles,
	fetchScans,
	type ScanTarget,
} from "../../../api";
import { buildSelectedScanTarget } from "./build-selected-scan-target";
import { selectProgressScanRun } from "./scan-progress-model";
import type { ScanLaunchState } from "./use-scan-launch-state";

type ScanLaunchEffectsScope = ScanLaunchState & {
	active: boolean;
	setErrorText: (text: string | null) => void;
};

export function useScanLaunchEffects(scope: ScanLaunchEffectsScope) {
	const {
		active,
		diffBaseRef,
		diffHeadRef,
		diffIncludeUntracked,
		diffPreview,
		diffPreviewRequestIdRef,
		diffPreviewResolvedInputKey,
		profiles,
		requestedProjectId,
		requestedScanRunId,
		scanRuns,
		scanTargetKind,
		selectedProfileId,
		selectedProjectId,
		selectedScanRunId,
		setActiveScanEvents,
		setDiffPreview,
		setDiffPreviewError,
		setDiffPreviewLoading,
		setDiffPreviewResolvedInputKey,
		setErrorText,
		setProfiles,
		setProjects,
		setScanDetailTab,
		setScanRuns,
		setScanRunsLoading,
		setScanTargetKind,
		setSelectedProjectId,
		setSelectedScanRunId,
	} = scope;

	useEffect(() => {
		if (!active) return;
		void fetchProjects()
			.then((items) => {
				setProjects(items);
				setSelectedProjectId((current: string) => {
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
	}, [
		active,
		requestedProjectId,
		setErrorText,
		setSelectedProjectId,
		setProjects,
	]);

	useEffect(() => {
		if (!active || !selectedProjectId) return;
		setScanRuns([]);
	}, [active, selectedProjectId, setScanRuns]);

	useEffect(() => {
		if (!active || !selectedProjectId) {
			setScanRunsLoading(false);
			return;
		}
		let mounted = true;
		setScanDetailTab("review");
		setScanRunsLoading(true);
		void fetchScans(selectedProjectId)
			.then((runs) => {
				if (!mounted) return;
				setScanRuns(runs);
				setSelectedScanRunId(
					runs.some((run) => run.id === requestedScanRunId)
						? requestedScanRunId
						: (runs[0]?.id ?? ""),
				);
			})
			.catch((err) => {
				if (!mounted) return;
				setErrorText(
					err instanceof Error
						? err.message
						: "scan の読み込みに失敗しました。",
				);
			})
			.finally(() => {
				if (mounted) setScanRunsLoading(false);
			});
		return () => {
			mounted = false;
		};
	}, [
		active,
		requestedScanRunId,
		selectedProjectId,
		setErrorText,
		setSelectedScanRunId,
		setScanDetailTab,
		setScanRuns,
		setScanRunsLoading,
	]);

	const unselectedActiveScanIds = scanRuns
		.filter(
			(scan) =>
				scan.id !== selectedScanRunId &&
				(scan.status === "queued" || scan.status === "running"),
		)
		.map((scan) => scan.id)
		.join(",");
	useEffect(() => {
		if (!active || !selectedProjectId || !unselectedActiveScanIds) return;
		let mounted = true;
		const refreshRuns = async () => {
			try {
				const runs = await fetchScans(selectedProjectId);
				if (mounted) setScanRuns(runs);
			} catch (error) {
				if (mounted) {
					setErrorText(error instanceof Error ? error.message : String(error));
				}
			}
		};
		const timer = setInterval(() => void refreshRuns(), 1_500);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, [
		active,
		selectedProjectId,
		setErrorText,
		setScanRuns,
		unselectedActiveScanIds,
	]);

	const progressScanRun = selectProgressScanRun(
		scanRuns,
		selectedScanRunId,
		selectedProjectId,
	);
	const progressScanRunId = progressScanRun?.id ?? "";
	useEffect(() => {
		if (
			!active ||
			!progressScanRunId ||
			progressScanRunId === selectedScanRunId
		) {
			setActiveScanEvents([]);
			return;
		}
		setActiveScanEvents([]);
		let mounted = true;
		const refreshProgressEvents = async () => {
			try {
				const events = await fetchScanEvents(progressScanRunId);
				if (mounted) setActiveScanEvents(events);
			} catch {
				if (mounted) setActiveScanEvents([]);
			}
		};
		void refreshProgressEvents();
		const timer = setInterval(() => void refreshProgressEvents(), 1_500);
		return () => {
			mounted = false;
			clearInterval(timer);
		};
	}, [active, progressScanRunId, selectedScanRunId, setActiveScanEvents]);

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

	return {
		diffPreviewCurrent,
		diffPreviewInputKey,
		buildSelectedScanTarget: () =>
			buildSelectedScanTarget({
				scanTargetKind,
				diffBaseRef,
				diffHeadRef,
				diffIncludeUntracked,
			}),
	};
}
