import { useEffect, useMemo, useState } from "react";
import {
	checkLlmProviderHealth,
	type CodexStatusResponse,
	fetchCodexStatus,
	fetchLlmSettings,
	fetchRuntimeSettings,
	type LlmModelTarget,
	type LlmProviderEndpoint,
	type LlmProviderHealthResult,
	type LlmSettingsResponse,
	type RuntimeSettingsResponse,
	type LlmTask,
	type LlmTaskRoute,
	updateLlmSettings,
	updateRuntimeSettings,
	updateSystemContext,
} from "./api";
import {
	emptyEndpoint,
	ensureCodexEndpoint,
	ensureRoutes,
	parseTargetKey,
	taskLabels,
	type SettingsPanelProps,
} from "./settings-panel-model";
import { SettingsPanelView } from "./settings-panel-view";

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
	setErrorText,
}: SettingsPanelProps) {
	const [llmSettings, setLlmSettings] = useState<LlmSettingsResponse | null>(
		null,
	);
	const [runtimeSettings, setRuntimeSettings] =
		useState<RuntimeSettingsResponse | null>(null);
	const [runtimeSaving, setRuntimeSaving] = useState(false);
	const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(
		null,
	);
	const [llmSaving, setLlmSaving] = useState(false);
	const [llmLoading, setLlmLoading] = useState(true);
	const [healthByEndpointId, setHealthByEndpointId] = useState<
		Record<string, LlmProviderHealthResult>
	>({});
	const [healthCheckingId, setHealthCheckingId] = useState<string | null>(null);
	const [codexStatus, setCodexStatus] = useState<CodexStatusResponse | null>(
		null,
	);

	const genericEndpoints = useMemo(
		() =>
			llmSettings?.providerEndpoints.filter(
				(endpoint) => endpoint.kind !== "codex",
			) ?? [],
		[llmSettings],
	);

	const codexEndpoint = useMemo(
		() =>
			llmSettings?.providerEndpoints.find(
				(endpoint) => endpoint.kind === "codex",
			) ?? null,
		[llmSettings],
	);

	useEffect(() => {
		if (!isAdmin) {
			setLlmLoading(false);
			return;
		}
		void (async () => {
			setLlmLoading(true);
			try {
				const [settings, codex, runtime] = await Promise.all([
					fetchLlmSettings(),
					fetchCodexStatus(),
					fetchRuntimeSettings(),
				]);
				const normalized = ensureCodexEndpoint(
					{
						...settings,
						taskRoutes: ensureRoutes(settings.taskRoutes),
					},
					codex,
				);
				setLlmSettings(normalized);
				setSelectedEndpointId(
					normalized.providerEndpoints.find(
						(endpoint) => endpoint.kind !== "codex",
					)?.id ?? null,
				);
				setCodexStatus(codex);
				setRuntimeSettings(runtime);
			} catch (error) {
				setErrorText(
					error instanceof Error ? error.message : "Failed to load settings.",
				);
			} finally {
				setLlmLoading(false);
			}
		})();
	}, [isAdmin, setErrorText]);

	const selectedEndpoint = useMemo(
		() =>
			genericEndpoints.find((endpoint) => endpoint.id === selectedEndpointId) ??
			null,
		[genericEndpoints, selectedEndpointId],
	);

	const targetOptions = useMemo(() => {
		const endpoints = llmSettings?.providerEndpoints ?? [];
		return endpoints.flatMap((endpoint) => {
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
					(endpoint.kind === "codex"
						? `${model} (codex)`
						: `${model} (${endpoint.name})`),
				enabled: endpoint.enabled,
			}));
		});
	}, [codexStatus, llmSettings]);

	const validationErrors = useMemo(() => {
		if (!llmSettings) return [];
		const errors: string[] = [];
		const ids = new Set<string>();
		for (const endpoint of llmSettings.providerEndpoints) {
			if (ids.has(endpoint.id))
				errors.push(`Duplicate endpoint: ${endpoint.id}`);
			ids.add(endpoint.id);
			if (!endpoint.name.trim()) errors.push("Provider name is required.");
			if (endpoint.models.length === 0 && endpoint.kind !== "codex") {
				errors.push(`${endpoint.name} requires at least one model.`);
			}
			if (
				endpoint.kind === "codex" &&
				endpoint.enabled &&
				!codexStatus?.authenticated
			) {
				errors.push("Codex SDK endpoint is enabled but not authenticated.");
			}
			if (
				endpoint.kind === "codex" &&
				endpoint.enabled &&
				codexStatus &&
				!codexStatus.executableAdapterAvailable
			) {
				errors.push("Codex SDK adapter is not available in this runtime.");
			}
			if (endpoint.kind === "azure" && !endpoint.endpoint?.trim()) {
				errors.push(`${endpoint.name} requires an endpoint.`);
			}
			if (
				(endpoint.kind === "openai" ||
					endpoint.kind === "openai-compatible" ||
					endpoint.kind === "local") &&
				!endpoint.baseUrl?.trim()
			) {
				errors.push(`${endpoint.name} requires a base URL.`);
			}
		}
		for (const route of llmSettings.taskRoutes) {
			const targets = [
				...(route.primaryTarget ? [route.primaryTarget] : []),
				...route.fallbackTargets,
			];
			for (const target of targets) {
				const endpoint = llmSettings.providerEndpoints.find(
					(item) => item.id === target.providerEndpointId,
				);
				if (!endpoint)
					errors.push(`${route.task} references a missing endpoint.`);
				if (endpoint && !endpoint.enabled) {
					errors.push(
						`${taskLabels[route.task]} references a disabled endpoint.`,
					);
				}
			}
		}
		return Array.from(new Set(errors));
	}, [codexStatus, llmSettings]);

	const updateEndpoint = (
		id: string,
		patch: Partial<LlmProviderEndpoint>,
	): void => {
		setLlmSettings((current) => {
			if (!current) return current;
			return {
				...current,
				providerEndpoints: current.providerEndpoints.map((endpoint) =>
					endpoint.id === id ? { ...endpoint, ...patch } : endpoint,
				),
			};
		});
	};

	const updateRuntimeSetting = (
		patch: Partial<Omit<RuntimeSettingsResponse, "updatedAt">>,
	): void => {
		setRuntimeSettings((current) =>
			current ? { ...current, ...patch } : current,
		);
	};

	const updateCodexEndpoint = (patch: Partial<LlmProviderEndpoint>): void => {
		setLlmSettings((current) => {
			if (!current) return current;
			const ensured = ensureCodexEndpoint(current, codexStatus);
			return {
				...ensured,
				providerEndpoints: ensured.providerEndpoints.map((endpoint) =>
					endpoint.kind === "codex" ? { ...endpoint, ...patch } : endpoint,
				),
			};
		});
	};

	const updateRoute = (task: LlmTask, patch: Partial<LlmTaskRoute>): void => {
		setLlmSettings((current) => {
			if (!current) return current;
			return {
				...current,
				taskRoutes: ensureRoutes(current.taskRoutes).map((route) =>
					route.task === task ? { ...route, ...patch } : route,
				),
			};
		});
	};

	const addFallback = (route: LlmTaskRoute): void => {
		const target = parseTargetKey(targetOptions[0]?.key ?? "");
		if (!target) return;
		updateRoute(route.task, {
			fallbackTargets: [...route.fallbackTargets, target],
		});
	};

	const updateFallback = (
		route: LlmTaskRoute,
		index: number,
		target: LlmModelTarget | null,
	): void => {
		const next = [...route.fallbackTargets];
		if (!target) {
			next.splice(index, 1);
		} else {
			next[index] = target;
		}
		updateRoute(route.task, { fallbackTargets: next });
	};

	const moveFallback = (
		route: LlmTaskRoute,
		index: number,
		direction: -1 | 1,
	): void => {
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= route.fallbackTargets.length) return;
		const next = [...route.fallbackTargets];
		[next[index], next[nextIndex]] = [next[nextIndex], next[index]];
		updateRoute(route.task, { fallbackTargets: next });
	};

	const handleAddEndpoint = () => {
		const endpoint = emptyEndpoint();
		setLlmSettings((current) => {
			const base = current ?? {
				providerEndpoints: [],
				taskRoutes: ensureRoutes([]),
				updatedAt: null,
			};
			return {
				...base,
				providerEndpoints: [...base.providerEndpoints, endpoint],
			};
		});
		setSelectedEndpointId(endpoint.id);
	};

	const handleDeleteEndpoint = (endpointId: string) => {
		setLlmSettings((current) => {
			if (!current) return current;
			const providerEndpoints = current.providerEndpoints.filter(
				(endpoint) => endpoint.id !== endpointId,
			);
			return {
				...current,
				providerEndpoints,
				taskRoutes: current.taskRoutes.map((route) => ({
					...route,
					primaryTarget:
						route.primaryTarget?.providerEndpointId === endpointId
							? null
							: route.primaryTarget,
					fallbackTargets: route.fallbackTargets.filter(
						(target) => target.providerEndpointId !== endpointId,
					),
				})),
			};
		});
		setSelectedEndpointId((current) =>
			current === endpointId
				? (llmSettings?.providerEndpoints.find(
						(item) => item.id !== endpointId && item.kind !== "codex",
					)?.id ?? null)
				: current,
		);
	};

	const handleSaveSystemContext = async () => {
		onSystemContextSavingChange(true);
		setErrorText(null);
		try {
			const updated = await updateSystemContext(systemContextText);
			onSystemContextSaved(updated.systemContext, updated.updatedAt);
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Failed to save settings.",
			);
		} finally {
			onSystemContextSavingChange(false);
		}
	};

	const handleSaveLlmSettings = async () => {
		if (!llmSettings || validationErrors.length > 0) return;
		setLlmSaving(true);
		setErrorText(null);
		try {
			const updated = await updateLlmSettings({
				providerEndpoints: llmSettings.providerEndpoints,
				taskRoutes: ensureRoutes(llmSettings.taskRoutes),
			});
			setLlmSettings({
				...updated,
				taskRoutes: ensureRoutes(updated.taskRoutes),
			});
			setSelectedEndpointId(
				updated.providerEndpoints.find(
					(endpoint) =>
						endpoint.id === selectedEndpointId && endpoint.kind !== "codex",
				)?.id ??
					updated.providerEndpoints.find(
						(endpoint) => endpoint.kind !== "codex",
					)?.id ??
					null,
			);
			setCodexStatus(await fetchCodexStatus());
		} catch (error) {
			setErrorText(
				error instanceof Error ? error.message : "Failed to save LLM settings.",
			);
		} finally {
			setLlmSaving(false);
		}
	};

	const handleSaveRuntimeSettings = async () => {
		if (!runtimeSettings) return;
		setRuntimeSaving(true);
		setErrorText(null);
		try {
			const { updatedAt: _updatedAt, ...input } = runtimeSettings;
			setRuntimeSettings(await updateRuntimeSettings(input));
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "Failed to save runtime settings.",
			);
		} finally {
			setRuntimeSaving(false);
		}
	};

	const handleHealth = async (endpointId: string) => {
		setHealthCheckingId(endpointId);
		setErrorText(null);
		try {
			const result = await checkLlmProviderHealth(endpointId);
			setHealthByEndpointId((current) => ({
				...current,
				[endpointId]: result,
			}));
		} catch (error) {
			setErrorText(
				error instanceof Error
					? error.message
					: "Provider health check failed.",
			);
		} finally {
			setHealthCheckingId(null);
		}
	};

	const llmSaveDisabled =
		!llmSettings || llmSaving || llmLoading || validationErrors.length > 0;

	return {
		isAdmin,
		appHealth,
		sourceHealth,
		systemContextText,
		systemContextUpdatedAt,
		systemContextSaving,
		onSystemContextTextChange,
		llmSettings,
		setLlmSettings,
		selectedEndpointId,
		setSelectedEndpointId,
		llmSaving,
		llmLoading,
		healthByEndpointId,
		healthCheckingId,
		codexStatus,
		setCodexStatus,
		genericEndpoints,
		codexEndpoint,
		selectedEndpoint,
		targetOptions,
		validationErrors,
		updateEndpoint,
		updateCodexEndpoint,
		updateRoute,
		addFallback,
		updateFallback,
		moveFallback,
		handleAddEndpoint,
		handleDeleteEndpoint,
		handleSaveSystemContext,
		handleSaveLlmSettings,
		handleHealth,
		llmSaveDisabled,
		runtimeSettings,
		runtimeSaving,
		updateRuntimeSetting,
		handleSaveRuntimeSettings,
	};
}

export type SettingsPanelModel = ReturnType<typeof useSettingsPanelModel>;

export function SettingsPanel(props: SettingsPanelProps) {
	return <SettingsPanelView model={useSettingsPanelModel(props)} />;
}
