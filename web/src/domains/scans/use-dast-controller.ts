import { useEffect, useState } from "react";
import {
	type DastArtifact,
	type DastEvidence,
	type DastProfile,
	type DastProfileConfig,
	type DastRun,
	type DastTargetConfig,
	fetchDastRunArtifacts,
	fetchProjectDastProfiles,
	fetchProjectDastRuns,
	fetchProjectDastTargets,
	fetchScans,
	saveProjectDastTarget,
	type ScanRun,
	triggerProjectDastRun,
} from "../../api";

function isVisibleDastTarget(target: DastTargetConfig): boolean {
	return !(
		target.metadata?.autoPrepared === true ||
		target.metadata?.ephemeral === true
	);
}

function manualDastTargetName(origin: string): string {
	try {
		return `手動 target ${new URL(origin).origin}`;
	} catch {
		return "手動 DAST target";
	}
}

export function useDastController({
	active,
	selectedProjectId,
	setScanRuns,
	setSelectedScanRunId,
}: {
	active: boolean;
	selectedProjectId: string;
	setScanRuns: (runs: ScanRun[]) => void;
	setSelectedScanRunId: (id: string) => void;
}) {
	const [dastTargets, setDastTargets] = useState<DastTargetConfig[]>([]);
	const [dastProfiles, setDastProfiles] = useState<DastProfile[]>([]);
	const [dastProfileConfigs, setDastProfileConfigs] = useState<
		DastProfileConfig[]
	>([]);
	const [dastRuns, setDastRuns] = useState<DastRun[]>([]);
	const [selectedDastTargetId, setSelectedDastTargetId] = useState("");
	const [selectedDastProfileId, setSelectedDastProfileId] =
		useState("http-baseline");
	const [dastTargetOrigin, setDastTargetOrigin] = useState("");
	const [lastAutoDastTargetOrigin, setLastAutoDastTargetOrigin] = useState<
		string | null
	>(null);
	const [dastLoading, setDastLoading] = useState(false);
	const [dastError, setDastError] = useState<string | null>(null);
	const [expandedDastRunId, setExpandedDastRunId] = useState<string | null>(
		null,
	);
	const [dastRunArtifacts, setDastRunArtifacts] = useState<
		Record<string, DastArtifact[]>
	>({});
	const [dastRunEvidence, setDastRunEvidence] = useState<
		Record<string, DastEvidence[]>
	>({});

	useEffect(() => {
		setDastTargetOrigin("");
		setLastAutoDastTargetOrigin(null);
		setSelectedDastTargetId("");
		if (!active || !selectedProjectId) {
			setDastTargets([]);
			setDastProfiles([]);
			setDastProfileConfigs([]);
			setDastRuns([]);
			return;
		}
		void Promise.all([
			fetchProjectDastTargets(selectedProjectId),
			fetchProjectDastProfiles(selectedProjectId),
			fetchProjectDastRuns(selectedProjectId),
		])
			.then(([targets, profilesRes, runs]) => {
				const visibleTargets = targets.targets.filter(isVisibleDastTarget);
				setDastTargets(visibleTargets);
				setDastProfiles(profilesRes.profiles);
				setDastProfileConfigs(profilesRes.configs);
				setDastRuns(runs.dastRuns);
				setSelectedDastTargetId(
					visibleTargets.find((target) => target.enabled)?.id ?? "",
				);
			})
			.catch((err) => {
				setDastError(
					err instanceof Error
						? err.message
						: "DAST 状態の読み込みに失敗しました。",
				);
				setDastTargets([]);
				setDastProfiles([]);
				setDastProfileConfigs([]);
				setDastRuns([]);
			});
	}, [active, selectedProjectId]);

	const refreshDastRuns = async () => {
		if (selectedProjectId) {
			setDastRuns((await fetchProjectDastRuns(selectedProjectId)).dastRuns);
		}
	};

	const saveManualDastTarget = async () => {
		const origin = dastTargetOrigin.trim();
		if (!selectedProjectId || !origin) {
			return null;
		}
		const res = await saveProjectDastTarget(selectedProjectId, {
			name: manualDastTargetName(origin),
			origin,
			allowedPathsJson: ["/"],
			maxDepth: 0,
			maxRequests: 20,
			rateLimitPerSec: 2,
			timeoutSec: 120,
		});
		const visibleTargets = (
			await fetchProjectDastTargets(selectedProjectId)
		).targets.filter(isVisibleDastTarget);
		setDastTargets(visibleTargets);
		setSelectedDastTargetId(res.target.id);
		return res.target;
	};

	const handleCreateDastTarget = async () => {
		if (!selectedProjectId) return;
		setDastLoading(true);
		setDastError(null);
		try {
			await saveManualDastTarget();
		} catch (err) {
			setDastError(
				err instanceof Error
					? err.message
					: "DAST target の保存に失敗しました。",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const openDastRun = async (runId: string) => {
		setExpandedDastRunId(runId);
		const res = await fetchDastRunArtifacts(runId);
		setDastRunArtifacts((prev) => ({ ...prev, [runId]: res.artifacts }));
		setDastRunEvidence((prev) => ({ ...prev, [runId]: res.evidence }));
	};

	const applyDastRunResult = async (res: {
		dastRunId: string | null;
		scanRunId: string | null;
		plan?: { autoTarget?: { origin?: string } };
	}) => {
		const autoOrigin = res.plan?.autoTarget?.origin;
		if (autoOrigin) {
			setLastAutoDastTargetOrigin(autoOrigin);
			setDastTargetOrigin("");
		}
		await refreshDastRuns();
		if (res.dastRunId) await openDastRun(res.dastRunId);
		if (res.scanRunId) {
			setScanRuns(await fetchScans(selectedProjectId));
			setSelectedScanRunId(res.scanRunId);
		}
	};

	const handleTriggerDastRun = async () => {
		if (!selectedProjectId || !selectedDastProfileId) {
			return;
		}
		setDastLoading(true);
		setDastError(null);
		try {
			const target = dastTargetOrigin.trim()
				? await saveManualDastTarget()
				: null;
			const targetConfigId = target?.id ?? selectedDastTargetId;
			if (!targetConfigId) {
				await applyDastRunResult(
					await triggerProjectDastRun(selectedProjectId, {
						autoTarget: true,
						profileId: selectedDastProfileId,
						runner: "host",
					}),
				);
				return;
			}
			const profileConfig = dastProfileConfigs.find(
				(item) =>
					item.profileId === selectedDastProfileId &&
					item.targetConfigId === targetConfigId &&
					item.enabled,
			);
			const res = await triggerProjectDastRun(selectedProjectId, {
				targetConfigId,
				profileId: selectedDastProfileId,
				profileConfigId: profileConfig?.id,
				runner: "host",
			});
			await applyDastRunResult(res);
		} catch (err) {
			setDastError(
				err instanceof Error
					? err.message
					: "DAST profile の実行に失敗しました。",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleAutoDastRun = async () => {
		if (!selectedProjectId) return;
		setDastLoading(true);
		setDastError(null);
		try {
			const res = await triggerProjectDastRun(selectedProjectId, {
				autoTarget: true,
				profileId: "http-baseline",
				runner: "host",
			});
			setDastTargets(
				(await fetchProjectDastTargets(selectedProjectId)).targets.filter(
					isVisibleDastTarget,
				),
			);
			await applyDastRunResult(res);
		} catch (err) {
			setDastError(
				err instanceof Error ? err.message : "自動 DAST の実行に失敗しました。",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleToggleDastRun = async (runId: string) => {
		if (expandedDastRunId === runId) return setExpandedDastRunId(null);
		if (dastRunArtifacts[runId]) return setExpandedDastRunId(runId);
		await openDastRun(runId).catch((err) =>
			setDastError(
				err instanceof Error
					? err.message
					: "DAST artifact の読み込みに失敗しました。",
			),
		);
	};

	return {
		dastTargets,
		dastProfiles,
		dastProfileConfigs,
		dastRuns,
		selectedDastTargetId,
		setSelectedDastTargetId,
		selectedDastProfileId,
		setSelectedDastProfileId,
		dastTargetOrigin,
		setDastTargetOrigin,
		lastAutoDastTargetOrigin,
		dastLoading,
		dastError,
		expandedDastRunId,
		dastRunArtifacts,
		dastRunEvidence,
		handleCreateDastTarget,
		handleTriggerDastRun,
		handleAutoDastRun,
		handleToggleDastRun,
	};
}
