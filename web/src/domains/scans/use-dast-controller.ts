import { useEffect, useState } from "react";
import {
	type DastArtifact,
	type DastAuthContext,
	type DastEvidence,
	type DastProfile,
	type DastProfileConfig,
	type DastRun,
	type DastRouteInventoryEntry,
	type DastTargetConfig,
	fetchDastRunArtifacts,
	fetchProjectDastAuthContexts,
	fetchProjectDastProfiles,
	fetchProjectDastRuns,
	fetchProjectDastTargets,
	fetchScans,
	createProjectDastAuthContext,
	revokeProjectDastAuthContext,
	rotateProjectDastAuthContext,
	saveProjectDastProfile,
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
	const [dastAuthContexts, setDastAuthContexts] = useState<DastAuthContext[]>(
		[],
	);
	const [selectedDastTargetId, setSelectedDastTargetId] = useState("");
	const [selectedDastProfileId, setSelectedDastProfileId] = useState(
		"web-passive-standard",
	);
	const [selectedDastAuthContextId, setSelectedDastAuthContextId] =
		useState("");
	const [dastIdentityRole, setDastIdentityRole] = useState("test-user");
	const [dastAuthLabel, setDastAuthLabel] = useState("DAST test identity");
	const [dastBearerToken, setDastBearerToken] = useState("");
	const [dastAuthStatusPath, setDastAuthStatusPath] = useState("/");
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
	const [dastRunRoutes, setDastRunRoutes] = useState<
		Record<string, DastRouteInventoryEntry[]>
	>({});

	useEffect(() => {
		setDastTargetOrigin("");
		setLastAutoDastTargetOrigin(null);
		setSelectedDastTargetId("");
		setSelectedDastAuthContextId("");
		if (!active || !selectedProjectId) {
			setDastTargets([]);
			setDastProfiles([]);
			setDastProfileConfigs([]);
			setDastRuns([]);
			setDastAuthContexts([]);
			return;
		}
		void Promise.all([
			fetchProjectDastTargets(selectedProjectId),
			fetchProjectDastProfiles(selectedProjectId),
			fetchProjectDastRuns(selectedProjectId),
			fetchProjectDastAuthContexts(selectedProjectId),
		])
			.then(([targets, profilesRes, runs, authContexts]) => {
				const visibleTargets = targets.targets.filter(isVisibleDastTarget);
				setDastTargets(visibleTargets);
				setDastProfiles(profilesRes.profiles);
				setDastProfileConfigs(profilesRes.configs);
				setDastRuns(runs.dastRuns);
				setDastAuthContexts(authContexts.authContexts);
				const selectedTargetId =
					visibleTargets.find((target) => target.enabled)?.id ?? "";
				setSelectedDastTargetId(selectedTargetId);
				setSelectedDastAuthContextId(
					authContexts.authContexts.find(
						(context) =>
							context.status === "active" &&
							context.targetConfigId === selectedTargetId,
					)?.id ?? "",
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
				setDastAuthContexts([]);
			});
	}, [active, selectedProjectId]);

	useEffect(() => {
		if (!selectedDastTargetId) {
			setSelectedDastAuthContextId("");
			return;
		}
		const current = dastAuthContexts.find(
			(context) =>
				context.id === selectedDastAuthContextId &&
				context.targetConfigId === selectedDastTargetId &&
				context.status === "active",
		);
		if (current) {
			setDastIdentityRole(current.identityRole);
			return;
		}
		if (selectedDastAuthContextId) setSelectedDastAuthContextId("");
	}, [dastAuthContexts, selectedDastAuthContextId, selectedDastTargetId]);

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
			maxDepth: 2,
			maxRequests: 100,
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
		setDastRunRoutes((prev) => ({
			...prev,
			[runId]: res.routeInventory,
		}));
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
			let profileConfig = dastProfileConfigs.find(
				(item) =>
					item.profileId === selectedDastProfileId &&
					item.targetConfigId === targetConfigId &&
					item.enabled,
			);
			const selectedProfile = dastProfiles.find(
				(profile) => profile.id === selectedDastProfileId,
			);
			if (!profileConfig && selectedProfile?.requiresRoutes) {
				const createdProfileConfig = (
					await saveProjectDastProfile(selectedProjectId, {
						targetConfigId,
						profileId: selectedDastProfileId,
						displayName: `${selectedProfile.displayName} UI profile`,
						routePathsJson: [dastAuthStatusPath.trim() || "/"],
						checkOptionsJson: { screenshotEnabled: false },
					})
				).config;
				profileConfig = createdProfileConfig;
				setDastProfileConfigs((current) => [...current, createdProfileConfig]);
			}
			const res = await triggerProjectDastRun(selectedProjectId, {
				targetConfigId,
				profileId: selectedDastProfileId,
				profileConfigId: profileConfig?.id,
				runner: "host",
				...(selectedDastProfileId === "authenticated-readonly-standard" ||
				selectedDastProfileId === "authenticated-readonly"
					? {
							authContextId: selectedDastAuthContextId,
							identityRole: dastIdentityRole,
						}
					: {}),
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
				profileId: "web-passive-standard",
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

	const refreshAuthContexts = async () => {
		if (!selectedProjectId) return;
		const contexts = (await fetchProjectDastAuthContexts(selectedProjectId))
			.authContexts;
		setDastAuthContexts(contexts);
		setSelectedDastAuthContextId((current) =>
			contexts.some((context) => context.id === current)
				? current
				: (contexts.find((context) => context.status === "active")?.id ?? ""),
		);
	};

	const handleCreateDastAuthContext = async () => {
		if (
			!selectedProjectId ||
			!selectedDastTargetId ||
			!dastBearerToken.trim() ||
			!dastIdentityRole.trim()
		) {
			return;
		}
		setDastLoading(true);
		setDastError(null);
		try {
			const created = await createProjectDastAuthContext(selectedProjectId, {
				targetConfigId: selectedDastTargetId,
				identityRole: dastIdentityRole.trim(),
				label: dastAuthLabel.trim() || "DAST test identity",
				secret: { kind: "bearer_token", token: dastBearerToken },
				loginFlow: [],
				successAssertions: [
					{
						kind: "status",
						path: dastAuthStatusPath.trim() || "/",
						expected: [200, 204],
					},
				],
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			});
			setDastBearerToken("");
			await refreshAuthContexts();
			setSelectedDastAuthContextId(created.authContext.id);
		} catch (error) {
			setDastError(
				error instanceof Error
					? error.message
					: "認証コンテキストの作成に失敗しました。",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleRotateDastAuthContext = async () => {
		const selectedContext = dastAuthContexts.find(
			(context) => context.id === selectedDastAuthContextId,
		);
		if (
			!selectedProjectId ||
			!selectedDastAuthContextId ||
			selectedContext?.authKind !== "bearer_token" ||
			!dastBearerToken.trim()
		)
			return;
		setDastLoading(true);
		setDastError(null);
		try {
			await rotateProjectDastAuthContext(
				selectedProjectId,
				selectedDastAuthContextId,
				{
					secret: { kind: "bearer_token", token: dastBearerToken },
					expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
				},
			);
			setDastBearerToken("");
			await refreshAuthContexts();
		} catch (error) {
			setDastError(
				error instanceof Error
					? error.message
					: "認証コンテキストのローテーションに失敗しました。",
			);
		} finally {
			setDastLoading(false);
		}
	};

	const handleRevokeDastAuthContext = async () => {
		if (!selectedProjectId || !selectedDastAuthContextId) return;
		setDastLoading(true);
		setDastError(null);
		try {
			await revokeProjectDastAuthContext(
				selectedProjectId,
				selectedDastAuthContextId,
			);
			await refreshAuthContexts();
		} catch (error) {
			setDastError(
				error instanceof Error
					? error.message
					: "認証コンテキストの失効に失敗しました。",
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
		setDastTargets,
		dastProfiles,
		dastProfileConfigs,
		setDastProfileConfigs,
		dastRuns,
		dastAuthContexts,
		setDastAuthContexts,
		selectedDastTargetId,
		setSelectedDastTargetId,
		selectedDastProfileId,
		setSelectedDastProfileId,
		selectedDastAuthContextId,
		setSelectedDastAuthContextId,
		dastIdentityRole,
		setDastIdentityRole,
		dastAuthLabel,
		setDastAuthLabel,
		dastBearerToken,
		setDastBearerToken,
		dastAuthStatusPath,
		setDastAuthStatusPath,
		dastTargetOrigin,
		setDastTargetOrigin,
		lastAutoDastTargetOrigin,
		dastLoading,
		dastError,
		expandedDastRunId,
		dastRunArtifacts,
		dastRunEvidence,
		dastRunRoutes,
		handleCreateDastTarget,
		handleTriggerDastRun,
		handleAutoDastRun,
		handleToggleDastRun,
		handleCreateDastAuthContext,
		handleRotateDastAuthContext,
		handleRevokeDastAuthContext,
	};
}
