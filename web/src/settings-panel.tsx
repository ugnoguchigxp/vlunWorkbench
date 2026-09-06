import { useEffect, useMemo, useRef, useState } from "react";
import {
	autoConfigureRuntimeIsolation,
	type CodexStatusResponse,
	checkLlmProviderHealth,
	fetchCodexStatus,
	fetchLlmSettings,
	fetchRuntimeSettings,
	generateDastAuthEncryptionKey,
	type LlmModelTarget,
	type LlmProviderEndpoint,
	type LlmProviderHealthResult,
	type LlmSettingsResponse,
	type LlmTask,
	type LlmTaskRoute,
	normalizeRuntimeSettingsResponse,
	type RuntimeSettingsResponse,
	type RuntimeSettingsUpdate,
	updateLlmSettings,
	updateRuntimeSettings,
	updateSystemContext,
} from "./api";
import {
	emptyEndpoint,
	ensureCodexEndpoint,
	ensureRoutes,
	parseTargetKey,
	type SettingsPanelProps,
	sameJson,
	taskLabels,
	toLlmSettingsInput,
} from "./settings-panel-model";
export { SettingsPanel } from "./settings-panel-component";

const toRuntimeSettingsInput = (
	settings: RuntimeSettingsResponse,
): RuntimeSettingsUpdate => {
	const normalized = normalizeRuntimeSettingsResponse(settings);
	const {
		updatedAt: _updatedAt,
		dastAuthEncryptionKeyConfigured: _configured,
		dastAuthEncryptionKeySource: _source,
		runtimeIsolationConfigured: _runtimeConfigured,
		runtimeIsolationMissingFields: _runtimeMissingFields,
		...input
	} = normalized;
	return input;
};

export function useSettingsPanelModel({
	isAdmin,
	appHealth,
	sourceHealth,
	systemContextText,
	systemContextUpdatedAt,
	systemContextSaving,
	onSystemContextTextChange,
	onSystemContextSaved,
	onSystemContextSavingChange,
	onDirtyChange,
}: SettingsPanelProps) {
	const [llmSettings, setLlmSettings] = useState<LlmSettingsResponse | null>(
		null,
	);
	const [savedLlmSettings, setSavedLlmSettings] =
		useState<LlmSettingsResponse | null>(null);
	const [runtimeSettings, setRuntimeSettings] =
		useState<RuntimeSettingsResponse | null>(null);
	const [savedRuntimeSettings, setSavedRuntimeSettings] =
		useState<RuntimeSettingsResponse | null>(null);
	const [savedSystemContextText, setSavedSystemContextText] =
		useState(systemContextText);
	const savedSystemContextUpdatedAt = useRef(systemContextUpdatedAt);
	const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
		null,
	);
	const [llmSaving, setLlmSaving] = useState(false);
	const [runtimeSaving, setRuntimeSaving] = useState(false);
	const [runtimeGeneratingDastAuthKey, setRuntimeGeneratingDastAuthKey] =
		useState(false);
	const [runtimeAutoConfiguring, setRuntimeAutoConfiguring] = useState(false);
	const [llmLoading, setLlmLoading] = useState(isAdmin);
	const [runtimeLoading, setRuntimeLoading] = useState(isAdmin);
	const [llmError, setLlmError] = useState<string | null>(null);
	const [runtimeError, setRuntimeError] = useState<string | null>(null);
	const [systemContextError, setSystemContextError] = useState<string | null>(
		null,
	);
	const [healthByEndpointId, setHealthByEndpointId] = useState<
		Record<string, LlmProviderHealthResult>
	>({});
	const [healthCheckingId, setHealthCheckingId] = useState<string | null>(null);
	const [codexStatus, setCodexStatus] = useState<CodexStatusResponse | null>(
		null,
	);

	useEffect(() => {
		if (savedSystemContextUpdatedAt.current === systemContextUpdatedAt) return;
		savedSystemContextUpdatedAt.current = systemContextUpdatedAt;
		setSavedSystemContextText(systemContextText);
	}, [systemContextText, systemContextUpdatedAt]);
	useEffect(() => {
		if (!isAdmin) {
			setLlmLoading(false);
			setRuntimeLoading(false);
			return;
		}
		let active = true;
		void (async () => {
			setLlmLoading(true);
			setRuntimeLoading(true);
			setLlmError(null);
			setRuntimeError(null);
			const [llmResult, codexResult, runtimeResult] = await Promise.allSettled([
				fetchLlmSettings(),
				fetchCodexStatus(),
				fetchRuntimeSettings(),
			]);
			if (!active) return;
			if (llmResult.status === "fulfilled") {
				const codex =
					codexResult.status === "fulfilled" ? codexResult.value : null;
				const next = ensureCodexEndpoint(
					{
						...llmResult.value,
						taskRoutes: ensureRoutes(llmResult.value.taskRoutes),
					},
					codex,
				);
				setLlmSettings(next);
				setSavedLlmSettings(next);
				setSelectedProviderId(next.providerEndpoints[0]?.id ?? null);
			} else
				setLlmError(
					llmResult.reason instanceof Error
						? llmResult.reason.message
						: "LLM設定を読み込めませんでした。",
				);
			if (codexResult.status === "fulfilled") setCodexStatus(codexResult.value);
			if (runtimeResult.status === "fulfilled") {
				const next = normalizeRuntimeSettingsResponse(runtimeResult.value);
				setRuntimeSettings(next);
				setSavedRuntimeSettings(next);
			} else
				setRuntimeError(
					runtimeResult.reason instanceof Error
						? runtimeResult.reason.message
						: "Runtime設定を読み込めませんでした。",
				);
			setLlmLoading(false);
			setRuntimeLoading(false);
		})();
		return () => {
			active = false;
		};
	}, [isAdmin]);

	const selectedProvider = useMemo(
		() =>
			llmSettings?.providerEndpoints.find(
				(endpoint) => endpoint.id === selectedProviderId,
			) ?? null,
		[llmSettings, selectedProviderId],
	);
	const targetOptions = useMemo(
		() =>
			(llmSettings?.providerEndpoints ?? []).flatMap((endpoint) => {
				const models =
					endpoint.kind === "codex" && codexStatus?.detectedModels.length
						? Array.from(
								new Set([...endpoint.models, ...codexStatus.detectedModels]),
							)
						: endpoint.models;
				return models.map((model) => ({
					key: `${endpoint.id}::${model}`,
					label:
						endpoint.modelDisplayNames[model]?.trim() ||
						`${model} (${endpoint.kind === "codex" ? "Codex" : endpoint.name})`,
					enabled: endpoint.enabled,
				}));
			}),
		[codexStatus, llmSettings],
	);
	const validationErrors = useMemo(() => {
		if (!llmSettings) return [];
		const errors: string[] = [];
		const ids = new Set<string>();
		for (const endpoint of llmSettings.providerEndpoints) {
			if (ids.has(endpoint.id))
				errors.push(`Duplicate endpoint: ${endpoint.id}`);
			ids.add(endpoint.id);
			if (!endpoint.name.trim()) errors.push("Provider name is required.");
			if (endpoint.models.length === 0 && endpoint.kind !== "codex")
				errors.push(`${endpoint.name} requires at least one model.`);
			if (
				endpoint.kind === "codex" &&
				endpoint.enabled &&
				codexStatus &&
				!codexStatus.authenticated
			)
				errors.push("Codex SDK endpoint is enabled but not authenticated.");
			if (
				endpoint.kind === "codex" &&
				endpoint.enabled &&
				codexStatus &&
				!codexStatus.executableAdapterAvailable
			)
				errors.push("Codex SDK adapter is not available in this runtime.");
			if (endpoint.kind === "azure" && !endpoint.endpoint?.trim())
				errors.push(`${endpoint.name} requires an endpoint.`);
			if (
				(endpoint.kind === "openai" ||
					endpoint.kind === "openai-compatible" ||
					endpoint.kind === "local") &&
				!endpoint.baseUrl?.trim()
			)
				errors.push(`${endpoint.name} requires a base URL.`);
		}
		for (const route of llmSettings.taskRoutes)
			for (const target of [
				...(route.primaryTarget ? [route.primaryTarget] : []),
				...route.fallbackTargets,
			]) {
				const endpoint = llmSettings.providerEndpoints.find(
					(item) => item.id === target.providerEndpointId,
				);
				if (!endpoint)
					errors.push(`${route.task} references a missing endpoint.`);
				if (endpoint && !endpoint.enabled)
					errors.push(
						`${taskLabels[route.task]} references a disabled endpoint.`,
					);
			}
		return Array.from(new Set(errors));
	}, [codexStatus, llmSettings]);
	const llmProviderDirty = Boolean(
		llmSettings &&
			savedLlmSettings &&
			!sameJson(
				llmSettings.providerEndpoints,
				savedLlmSettings.providerEndpoints,
			),
	);
	const taskRoutingDirty = Boolean(
		llmSettings &&
			savedLlmSettings &&
			!sameJson(
				ensureRoutes(llmSettings.taskRoutes),
				ensureRoutes(savedLlmSettings.taskRoutes),
			),
	);
	const llmDirty = llmProviderDirty || taskRoutingDirty;
	const runtimeDirty = Boolean(
		runtimeSettings &&
			savedRuntimeSettings &&
			!sameJson(
				toRuntimeSettingsInput(runtimeSettings),
				toRuntimeSettingsInput(savedRuntimeSettings),
			),
	);
	const systemContextDirty = systemContextText !== savedSystemContextText;
	const settingsDirty = llmDirty || runtimeDirty || systemContextDirty;
	useEffect(() => {
		onDirtyChange(settingsDirty);
	}, [onDirtyChange, settingsDirty]);

	const updateEndpoint = (id: string, patch: Partial<LlmProviderEndpoint>) =>
		setLlmSettings((current) =>
			current
				? {
						...current,
						providerEndpoints: current.providerEndpoints.map((endpoint) =>
							endpoint.id === id ? { ...endpoint, ...patch } : endpoint,
						),
					}
				: current,
		);
	const updateRuntimeSetting = (patch: Partial<RuntimeSettingsUpdate>) =>
		setRuntimeSettings((current) =>
			current ? { ...current, ...patch } : current,
		);
	const updateRoute = (task: LlmTask, patch: Partial<LlmTaskRoute>) =>
		setLlmSettings((current) =>
			current
				? {
						...current,
						taskRoutes: ensureRoutes(current.taskRoutes).map((route) =>
							route.task === task ? { ...route, ...patch } : route,
						),
					}
				: current,
		);
	const addFallback = (route: LlmTaskRoute) => {
		const target = parseTargetKey(targetOptions[0]?.key ?? "");
		if (target)
			updateRoute(route.task, {
				fallbackTargets: [...route.fallbackTargets, target],
			});
	};
	const updateFallback = (
		route: LlmTaskRoute,
		index: number,
		target: LlmModelTarget | null,
	) => {
		const fallbackTargets = [...route.fallbackTargets];
		target
			? fallbackTargets.splice(index, 1, target)
			: fallbackTargets.splice(index, 1);
		updateRoute(route.task, { fallbackTargets });
	};
	const moveFallback = (
		route: LlmTaskRoute,
		index: number,
		direction: -1 | 1,
	) => {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= route.fallbackTargets.length) return;
		const fallbackTargets = [...route.fallbackTargets];
		[fallbackTargets[index], fallbackTargets[nextIndex]] = [
			fallbackTargets[nextIndex],
			fallbackTargets[index],
		];
		updateRoute(route.task, { fallbackTargets });
	};
	const handleAddEndpoint = () => {
		const endpoint = emptyEndpoint();
		setLlmSettings((current) =>
			current
				? {
						...current,
						providerEndpoints: [...current.providerEndpoints, endpoint],
					}
				: current,
		);
		setSelectedProviderId(endpoint.id);
	};
	const handleDeleteEndpoint = (id: string) => {
		const endpoint = llmSettings?.providerEndpoints.find(
			(item) => item.id === id,
		);
		if (
			!endpoint ||
			!window.confirm(`プロバイダー『${endpoint.name}』を削除しますか？`)
		)
			return;
		setLlmSettings((current) =>
			current
				? {
						...current,
						providerEndpoints: current.providerEndpoints.filter(
							(item) => item.id !== id,
						),
						taskRoutes: current.taskRoutes.map((route) => ({
							...route,
							primaryTarget:
								route.primaryTarget?.providerEndpointId === id
									? null
									: route.primaryTarget,
							fallbackTargets: route.fallbackTargets.filter(
								(target) => target.providerEndpointId !== id,
							),
						})),
					}
				: current,
		);
		setSelectedProviderId(
			llmSettings?.providerEndpoints.find((item) => item.kind === "codex")
				?.id ?? null,
		);
	};
	const handleSaveSystemContext = async () => {
		onSystemContextSavingChange(true);
		setSystemContextError(null);
		try {
			const updated = await updateSystemContext(systemContextText);
			setSavedSystemContextText(updated.systemContext);
			onSystemContextSaved(updated.systemContext, updated.updatedAt);
		} catch (error) {
			setSystemContextError(
				error instanceof Error
					? error.message
					: "System Contextを保存できませんでした。",
			);
		} finally {
			onSystemContextSavingChange(false);
		}
	};
	const handleSaveLlmSettings = async () => {
		if (!llmSettings || validationErrors.length) return;
		setLlmSaving(true);
		setLlmError(null);
		try {
			const response = await updateLlmSettings(toLlmSettingsInput(llmSettings));
			const updated = ensureCodexEndpoint(
				{ ...response, taskRoutes: ensureRoutes(response.taskRoutes) },
				codexStatus,
			);
			setLlmSettings(updated);
			setSavedLlmSettings(updated);
		} catch (error) {
			setLlmError(
				error instanceof Error
					? error.message
					: "LLM設定を保存できませんでした。",
			);
		} finally {
			setLlmSaving(false);
		}
	};
	const handleSaveRuntimeSettings = async () => {
		if (!runtimeSettings) return;
		setRuntimeSaving(true);
		setRuntimeError(null);
		try {
			const updated = normalizeRuntimeSettingsResponse(
				await updateRuntimeSettings(toRuntimeSettingsInput(runtimeSettings)),
			);
			setRuntimeSettings(updated);
			setSavedRuntimeSettings(updated);
		} catch (error) {
			setRuntimeError(
				error instanceof Error
					? error.message
					: "Runtime設定を保存できませんでした。",
			);
		} finally {
			setRuntimeSaving(false);
		}
	};
	const handleGenerateDastAuthKey = async () => {
		if (!runtimeSettings || runtimeDirty) return;
		setRuntimeGeneratingDastAuthKey(true);
		setRuntimeError(null);
		try {
			const updated = normalizeRuntimeSettingsResponse(
				await generateDastAuthEncryptionKey(
					toRuntimeSettingsInput(runtimeSettings),
				),
			);
			setRuntimeSettings(updated);
			setSavedRuntimeSettings(updated);
		} catch (error) {
			setRuntimeError(
				error instanceof Error
					? error.message
					: "DAST鍵を生成できませんでした。",
			);
		} finally {
			setRuntimeGeneratingDastAuthKey(false);
		}
	};
	const handleAutoConfigureRuntimeIsolation = async () => {
		if (runtimeDirty) return;
		setRuntimeAutoConfiguring(true);
		setRuntimeError(null);
		try {
			const updated = normalizeRuntimeSettingsResponse(
				await autoConfigureRuntimeIsolation(),
			);
			setRuntimeSettings(updated);
			setSavedRuntimeSettings(updated);
		} catch (error) {
			setRuntimeError(
				error instanceof Error
					? error.message
					: "Runtimeを自動設定できませんでした。",
			);
		} finally {
			setRuntimeAutoConfiguring(false);
		}
	};
	const handleHealth = async (id: string) => {
		if (llmProviderDirty) return;
		setHealthCheckingId(id);
		setLlmError(null);
		try {
			const result = await checkLlmProviderHealth(id);
			setHealthByEndpointId((current) => ({ ...current, [id]: result }));
		} catch (error) {
			setLlmError(
				error instanceof Error ? error.message : "接続確認に失敗しました。",
			);
		} finally {
			setHealthCheckingId(null);
		}
	};
	const refreshCodexStatus = async () => {
		setLlmError(null);
		try {
			const next = await fetchCodexStatus();
			setCodexStatus(next);
			setLlmSettings((current) =>
				current ? ensureCodexEndpoint(current, next) : current,
			);
			setSavedLlmSettings((current) =>
				current ? ensureCodexEndpoint(current, next) : current,
			);
		} catch (error) {
			setLlmError(
				error instanceof Error
					? error.message
					: "Codexの状態を取得できませんでした。",
			);
		}
	};
	return {
		isAdmin,
		appHealth,
		sourceHealth,
		systemContextText,
		systemContextUpdatedAt,
		systemContextSaving,
		onSystemContextTextChange,
		llmSettings,
		selectedProviderId,
		setSelectedProviderId,
		selectedProvider,
		llmSaving,
		llmLoading,
		llmError,
		healthByEndpointId,
		healthCheckingId,
		codexStatus,
		targetOptions,
		validationErrors,
		updateEndpoint,
		updateRoute,
		addFallback,
		updateFallback,
		moveFallback,
		handleAddEndpoint,
		handleDeleteEndpoint,
		handleSaveSystemContext,
		handleSaveLlmSettings,
		handleSaveRuntimeSettings,
		handleGenerateDastAuthKey,
		handleAutoConfigureRuntimeIsolation,
		handleHealth,
		refreshCodexStatus,
		llmSaveDisabled:
			!llmSettings ||
			llmSaving ||
			llmLoading ||
			validationErrors.length > 0 ||
			!llmDirty,
		runtimeSettings,
		runtimeSaving,
		runtimeLoading,
		runtimeError,
		runtimeGeneratingDastAuthKey,
		runtimeAutoConfiguring,
		runtimeDirty,
		updateRuntimeSetting,
		systemContextDirty,
		systemContextError,
		settingsDirty,
		llmProviderDirty,
		taskRoutingDirty,
	};
}

export type SettingsPanelModel = ReturnType<typeof useSettingsPanelModel>;
