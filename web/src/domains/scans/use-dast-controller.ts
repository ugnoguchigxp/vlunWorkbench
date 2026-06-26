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
	const [dastTargetName, setDastTargetName] = useState("Local app");
	const [dastTargetOrigin, setDastTargetOrigin] = useState(
		"http://127.0.0.1:29831",
	);
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
		if (!active || !selectedProjectId) return;
		void Promise.all([
			fetchProjectDastTargets(selectedProjectId),
			fetchProjectDastProfiles(selectedProjectId),
			fetchProjectDastRuns(selectedProjectId),
		])
			.then(([targets, profilesRes, runs]) => {
				setDastTargets(targets.targets);
				setDastProfiles(profilesRes.profiles);
				setDastProfileConfigs(profilesRes.configs);
				setDastRuns(runs.dastRuns);
				setSelectedDastTargetId(
					targets.targets.find((target) => target.enabled)?.id ?? "",
				);
			})
			.catch((err) => {
				setDastError(
					err instanceof Error ? err.message : "Failed to load DAST state.",
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

	const handleCreateDastTarget = async () => {
		if (!selectedProjectId) return;
		setDastLoading(true);
		setDastError(null);
		try {
			const res = await saveProjectDastTarget(selectedProjectId, {
				name: dastTargetName,
				origin: dastTargetOrigin,
				allowedPathsJson: ["/"],
				maxDepth: 0,
				maxRequests: 20,
				rateLimitPerSec: 2,
				timeoutSec: 120,
			});
			setDastTargets(
				(await fetchProjectDastTargets(selectedProjectId)).targets,
			);
			setSelectedDastTargetId(res.target.id);
		} catch (err) {
			setDastError(
				err instanceof Error ? err.message : "Failed to save DAST target.",
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

	const handleTriggerDastRun = async () => {
		if (!selectedProjectId || !selectedDastTargetId || !selectedDastProfileId) {
			return;
		}
		setDastLoading(true);
		setDastError(null);
		try {
			const profileConfig = dastProfileConfigs.find(
				(item) =>
					item.profileId === selectedDastProfileId &&
					item.targetConfigId === selectedDastTargetId &&
					item.enabled,
			);
			const res = await triggerProjectDastRun(selectedProjectId, {
				targetConfigId: selectedDastTargetId,
				profileId: selectedDastProfileId,
				profileConfigId: profileConfig?.id,
				runner: "host",
			});
			await refreshDastRuns();
			if (res.dastRunId) await openDastRun(res.dastRunId);
			if (res.scanRunId) {
				setScanRuns(await fetchScans(selectedProjectId));
				setSelectedScanRunId(res.scanRunId);
			}
		} catch (err) {
			setDastError(
				err instanceof Error ? err.message : "Failed to run DAST profile.",
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
				err instanceof Error ? err.message : "Failed to load DAST artifacts.",
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
		dastTargetName,
		setDastTargetName,
		dastTargetOrigin,
		setDastTargetOrigin,
		dastLoading,
		dastError,
		expandedDastRunId,
		dastRunArtifacts,
		dastRunEvidence,
		handleCreateDastTarget,
		handleTriggerDastRun,
		handleToggleDastRun,
	};
}
