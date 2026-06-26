import {
	Activity,
	ArrowDown,
	ArrowUp,
	BookOpen,
	Brain,
	CheckCircle2,
	Database,
	GitBranch,
	Plus,
	RefreshCw,
	Save,
	Trash2,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	type CodexStatusResponse,
	checkLlmProviderHealth,
	fetchCodexStatus,
	fetchLlmSettings,
	type LlmModelTarget,
	type LlmProviderEndpoint,
	type LlmProviderHealthResult,
	type LlmProviderKind,
	type LlmSettingsResponse,
	type LlmTask,
	type LlmTaskRoute,
	type LlmThinkingDepth,
	updateLlmSettings,
	updateSystemContext,
} from "./api";
import type { AppHealth, SourceHealth } from "./settings-panel-types";
import { Button, SelectInput, TextArea, TextInput } from "./ui";

const LLM_TASKS: LlmTask[] = [
	"finding_review",
	"scan_review",
	"evidence_context",
	"agentic_search",
	"report_summary",
];

const PROVIDER_KINDS: LlmProviderKind[] = [
	"azure",
	"openai",
	"openai-compatible",
	"bedrock",
	"local",
];

const providerKindLabels: Record<LlmProviderKind, string> = {
	azure: "Azure OpenAI",
	openai: "OpenAI",
	"openai-compatible": "OpenAI Compatible",
	bedrock: "AWS Bedrock",
	local: "Local LLM",
	codex: "Codex SDK",
};

const thinkingDepthOptions: Array<{
	value: "" | LlmThinkingDepth;
	label: string;
}> = [
	{ value: "", label: "Auto" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "very_high", label: "Very high" },
];

const taskLabels: Record<LlmTask, string> = {
	finding_review: "Finding Review",
	scan_review: "Scan Review",
	evidence_context: "Evidence Context",
	agentic_search: "Agentic Search",
	report_summary: "Report Summary",
};

type SettingsPanelProps = {
	appHealth: AppHealth | null;
	sourceHealth: SourceHealth | null;
	systemContextText: string;
	systemContextUpdatedAt: string | null;
	systemContextSaving: boolean;
	onSystemContextTextChange: (value: string) => void;
	onSystemContextSaved: (systemContext: string, updatedAt: string) => void;
	onSystemContextSavingChange: (saving: boolean) => void;
	setErrorText: (message: string | null) => void;
};

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

const createId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `endpoint-${Date.now()}`;

const emptyEndpoint = (): LlmProviderEndpoint => ({
	id: `provider-${createId()}`,
	name: "New Provider",
	kind: "openai-compatible",
	enabled: true,
	apiKey: "",
	baseUrl: "http://127.0.0.1:11434/v1",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: ["qwen3-coder"],
	modelDisplayNames: {},
	modelCapabilities: {},
});

const emptyCodexEndpoint = (
	codexStatus: CodexStatusResponse | null,
): LlmProviderEndpoint => ({
	id: "codex-default",
	name: "Codex SDK",
	kind: "codex",
	enabled: Boolean(codexStatus?.authenticated),
	apiKey: "",
	baseUrl: "",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: codexStatus?.detectedModels ?? [],
	modelDisplayNames: {},
	modelCapabilities: {},
});

const ensureCodexEndpoint = (
	settings: LlmSettingsResponse,
	codexStatus: CodexStatusResponse | null,
): LlmSettingsResponse => {
	const codexEndpoint =
		settings.providerEndpoints.find((endpoint) => endpoint.kind === "codex") ??
		emptyCodexEndpoint(codexStatus);
	const models = Array.from(
		new Set([...codexEndpoint.models, ...(codexStatus?.detectedModels ?? [])]),
	);
	return {
		...settings,
		providerEndpoints: [
			...settings.providerEndpoints.filter(
				(endpoint) => endpoint.kind !== "codex",
			),
			{
				...codexEndpoint,
				models,
			},
		],
	};
};

const ensureRoutes = (routes: LlmTaskRoute[]): LlmTaskRoute[] =>
	LLM_TASKS.map(
		(task) =>
			routes.find((route) => route.task === task) ?? {
				task,
				primaryTarget: null,
				fallbackTargets: [],
				policy: {},
			},
	);

const modelText = (endpoint: LlmProviderEndpoint): string =>
	endpoint.models.join(", ");

const parseModels = (value: string): string[] =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const formatModelDisplayNames = (value: Record<string, string>): string =>
	Object.entries(value)
		.map(([model, label]) => `${model}=${label}`)
		.join("\n");

const parseModelDisplayNames = (value: string): Record<string, string> =>
	Object.fromEntries(
		value
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [model, ...rest] = line.split("=");
				return [model.trim(), rest.join("=").trim()];
			})
			.filter(([model, label]) => Boolean(model && label)),
	);

const isThinkingModel = (model: string): boolean => {
	const normalized = model.toLowerCase();
	return (
		/^gpt-5(\b|[.-])/.test(normalized) ||
		/^o[134](\b|[.-])/.test(normalized) ||
		normalized.includes("codex") ||
		normalized.includes("reasoning") ||
		normalized.includes("thinking") ||
		normalized.includes("deepseek-r1") ||
		normalized.includes("qwen3")
	);
};

const withThinkingDepth = (
	target: LlmModelTarget | null,
	thinkingDepth: "" | LlmThinkingDepth,
): LlmModelTarget | null => {
	if (!target) return null;
	return {
		...target,
		thinkingDepth: isThinkingModel(target.model)
			? thinkingDepth || undefined
			: undefined,
	};
};

const targetKey = (target?: LlmModelTarget | null): string =>
	target ? `${target.providerEndpointId}::${target.model}` : "";

const parseTargetKey = (value: string): LlmModelTarget | null => {
	if (!value) return null;
	const [providerEndpointId, model] = value.split("::");
	if (!providerEndpointId || !model) return null;
	return { providerEndpointId, model };
};

const fallbackKey = (
	route: LlmTaskRoute,
	target: LlmModelTarget,
	index: number,
): string =>
	`${route.task}-${target.providerEndpointId}-${target.model}-${target.thinkingDepth ?? "auto"}-${index}`;

export function SettingsPanel({
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
		void (async () => {
			setLlmLoading(true);
			try {
				const [settings, codex] = await Promise.all([
					fetchLlmSettings(),
					fetchCodexStatus(),
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
			} catch (error) {
				setErrorText(
					error instanceof Error ? error.message : "Failed to load settings.",
				);
			} finally {
				setLlmLoading(false);
			}
		})();
	}, [setErrorText]);

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
	}, [llmSettings]);

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

	return (
		<main className="layout settings-layout">
			<section className="panel">
				<div className="panel-header">
					<h2>Runtime</h2>
				</div>
				<div className="settings-grid-2">
					<div className="meta-list compact">
						<div>
							<Activity />
							<span>{appHealth?.status ?? "-"}</span>
						</div>
						<div>
							<Database />
							<span>{appHealth?.service ?? "-"}</span>
						</div>
					</div>
					<div className="meta-list compact">
						<div>
							<GitBranch />
							<span>{sourceHealth?.git?.branch ?? "-"}</span>
						</div>
						<div>
							<BookOpen />
							<span>{sourceHealth?.git?.commit ?? "-"}</span>
						</div>
					</div>
				</div>
			</section>

			<section className="panel settings-system-panel">
				<div className="panel-header">
					<h2>System Context</h2>
				</div>
				<div className="form-stack">
					<label htmlFor="system-context-input">Agentic Search Prompt</label>
					<TextArea
						id="system-context-input"
						value={systemContextText}
						onChange={(event) => onSystemContextTextChange(event.target.value)}
						placeholder="System context for this user..."
					/>
					<div className="actions">
						<Button
							type="button"
							variant="primary"
							onClick={() => void handleSaveSystemContext()}
							disabled={systemContextSaving}
						>
							<Brain className="icon" />
							<span>Save</span>
						</Button>
						<small>updated: {formatDateTime(systemContextUpdatedAt)}</small>
					</div>
				</div>
			</section>

			<section className="panel llm-settings-panel">
				<div className="panel-header">
					<h2>LLM Providers</h2>
					<div className="actions">
						<Button type="button" onClick={handleAddEndpoint}>
							<Plus className="icon" />
							<span>Add</span>
						</Button>
						<Button
							type="button"
							variant="primary"
							onClick={() => void handleSaveLlmSettings()}
							disabled={llmSaving || llmLoading || validationErrors.length > 0}
						>
							<Save className="icon" />
							<span>Save</span>
						</Button>
					</div>
				</div>

				{llmLoading ? (
					<div className="tree-info">Loading LLM settings...</div>
				) : null}

				{llmSettings ? (
					<div className="llm-settings-grid">
						<div className="codex-status-card">
							<div className="codex-status-header">
								<div>
									<strong>Codex SDK</strong>
									<small>{codexStatus?.codexHome ?? "-"}</small>
								</div>
								<Button
									type="button"
									onClick={async () => {
										const next = await fetchCodexStatus();
										setCodexStatus(next);
										setLlmSettings((current) =>
											current ? ensureCodexEndpoint(current, next) : current,
										);
									}}
								>
									<RefreshCw className="icon" />
								</Button>
							</div>
							<div className="codex-status-values">
								<span
									className={
										codexStatus?.authenticated ? "health-ok" : "health-fail"
									}
								>
									{codexStatus?.authSource ?? "unchecked"}
								</span>
								<span>{codexStatus?.modelSource ?? "-"}</span>
								<span>
									{codexStatus?.detectedModels.length
										? `${codexStatus.detectedModels.length} models`
										: "-"}
								</span>
							</div>
							{codexEndpoint ? (
								<div className="codex-settings-grid">
									<div className="settings-form-field">
										<label htmlFor="codex-enabled">Codex SDK</label>
										<SelectInput
											id="codex-enabled"
											value={codexEndpoint.enabled ? "true" : "false"}
											onChange={(event) =>
												updateCodexEndpoint({
													enabled: event.target.value === "true",
												})
											}
										>
											<option value="true">Enabled</option>
											<option value="false">Disabled</option>
										</SelectInput>
									</div>
									<div className="settings-form-field">
										<label htmlFor="codex-token">Access Token Override</label>
										<TextInput
											id="codex-token"
											type="password"
											value={codexEndpoint.apiKey}
											onChange={(event) =>
												updateCodexEndpoint({
													apiKey: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor="codex-models">Models</label>
										<TextInput
											id="codex-models"
											value={modelText(codexEndpoint)}
											onChange={(event) =>
												updateCodexEndpoint({
													models: parseModels(event.target.value),
												})
											}
										/>
									</div>
								</div>
							) : null}
						</div>
						<div className="endpoint-list">
							{genericEndpoints.map((endpoint) => {
								const health = healthByEndpointId[endpoint.id];
								return (
									<button
										type="button"
										key={endpoint.id}
										className={[
											"endpoint-row",
											selectedEndpointId === endpoint.id ? "active" : "",
										]
											.filter(Boolean)
											.join(" ")}
										onClick={() => setSelectedEndpointId(endpoint.id)}
									>
										<span>
											<strong>{endpoint.name}</strong>
											<small>{endpoint.kind}</small>
										</span>
										{health ? (
											health.ok ? (
												<CheckCircle2 className="icon health-ok" />
											) : (
												<XCircle className="icon health-fail" />
											)
										) : null}
									</button>
								);
							})}
						</div>

						{selectedEndpoint ? (
							<div className="endpoint-editor">
								<div className="provider-editor-header">
									<div className="settings-form-field">
										<label htmlFor={`llm-name-${selectedEndpoint.id}`}>
											Name
										</label>
										<TextInput
											id={`llm-name-${selectedEndpoint.id}`}
											value={selectedEndpoint.name}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													name: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field">
										<label htmlFor={`llm-kind-${selectedEndpoint.id}`}>
											Kind
										</label>
										<SelectInput
											id={`llm-kind-${selectedEndpoint.id}`}
											value={selectedEndpoint.kind}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													kind: event.target.value as LlmProviderKind,
												})
											}
										>
											{PROVIDER_KINDS.map((kind) => (
												<option key={kind} value={kind}>
													{providerKindLabels[kind]}
												</option>
											))}
										</SelectInput>
									</div>
									<div className="settings-form-field settings-checkbox-field">
										<span className="settings-field-label">Enabled</span>
										<label
											className="settings-check-button"
											htmlFor={`llm-enabled-${selectedEndpoint.id}`}
										>
											<input
												id={`llm-enabled-${selectedEndpoint.id}`}
												type="checkbox"
												checked={selectedEndpoint.enabled}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														enabled: event.target.checked,
													})
												}
											/>
											<span>
												{selectedEndpoint.enabled ? "Enabled" : "Disabled"}
											</span>
										</label>
									</div>
								</div>
								<div className="settings-form-grid">
									{selectedEndpoint.kind === "azure" ? (
										<>
											<div className="settings-form-field">
												<label htmlFor={`llm-endpoint-${selectedEndpoint.id}`}>
													Endpoint
												</label>
												<TextInput
													id={`llm-endpoint-${selectedEndpoint.id}`}
													value={selectedEndpoint.endpoint ?? ""}
													onChange={(event) =>
														updateEndpoint(selectedEndpoint.id, {
															endpoint: event.target.value,
														})
													}
												/>
											</div>
											<div className="settings-form-field">
												<label
													htmlFor={`llm-api-version-${selectedEndpoint.id}`}
												>
													API Version
												</label>
												<TextInput
													id={`llm-api-version-${selectedEndpoint.id}`}
													value={selectedEndpoint.apiVersion ?? ""}
													onChange={(event) =>
														updateEndpoint(selectedEndpoint.id, {
															apiVersion: event.target.value,
														})
													}
												/>
											</div>
										</>
									) : null}
									{selectedEndpoint.kind === "bedrock" ? (
										<div className="settings-form-field">
											<label htmlFor={`llm-region-${selectedEndpoint.id}`}>
												Region
											</label>
											<TextInput
												id={`llm-region-${selectedEndpoint.id}`}
												value={selectedEndpoint.region ?? ""}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														region: event.target.value,
													})
												}
											/>
										</div>
									) : null}
									{selectedEndpoint.kind === "openai" ||
									selectedEndpoint.kind === "openai-compatible" ||
									selectedEndpoint.kind === "local" ? (
										<div className="settings-form-field">
											<label htmlFor={`llm-base-url-${selectedEndpoint.id}`}>
												Base URL
											</label>
											<TextInput
												id={`llm-base-url-${selectedEndpoint.id}`}
												value={selectedEndpoint.baseUrl ?? ""}
												onChange={(event) =>
													updateEndpoint(selectedEndpoint.id, {
														baseUrl: event.target.value,
													})
												}
											/>
										</div>
									) : null}
									<div className="settings-form-field">
										<label htmlFor={`llm-api-key-${selectedEndpoint.id}`}>
											API Key
										</label>
										<TextInput
											id={`llm-api-key-${selectedEndpoint.id}`}
											type="password"
											value={selectedEndpoint.apiKey}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													apiKey: event.target.value,
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor={`llm-models-${selectedEndpoint.id}`}>
											Models
										</label>
										<TextInput
											id={`llm-models-${selectedEndpoint.id}`}
											value={modelText(selectedEndpoint)}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													models: parseModels(event.target.value),
												})
											}
										/>
									</div>
									<div className="settings-form-field settings-field-wide">
										<label htmlFor={`llm-model-labels-${selectedEndpoint.id}`}>
											Model Select Labels
										</label>
										<TextArea
											id={`llm-model-labels-${selectedEndpoint.id}`}
											value={formatModelDisplayNames(
												selectedEndpoint.modelDisplayNames,
											)}
											onChange={(event) =>
												updateEndpoint(selectedEndpoint.id, {
													modelDisplayNames: parseModelDisplayNames(
														event.target.value,
													),
												})
											}
											placeholder="gpt-4.1=Review JSON (Azure)"
										/>
									</div>
								</div>
								<div className="actions">
									<Button
										type="button"
										onClick={() => void handleHealth(selectedEndpoint.id)}
										disabled={healthCheckingId === selectedEndpoint.id}
									>
										<RefreshCw className="icon" />
										<span>Health</span>
									</Button>
									<Button
										type="button"
										variant="destructive"
										onClick={() => handleDeleteEndpoint(selectedEndpoint.id)}
									>
										<Trash2 className="icon" />
										<span>Remove</span>
									</Button>
									{healthByEndpointId[selectedEndpoint.id]?.message ? (
										<small>
											{healthByEndpointId[selectedEndpoint.id]?.message}
										</small>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</section>

			<section className="panel">
				<div className="panel-header">
					<h2>Task Routing</h2>
				</div>
				<div className="route-card-list">
					{ensureRoutes(llmSettings?.taskRoutes ?? []).map((route) => (
						<div className="route-card" key={route.task}>
							<div className="route-card-header">
								<div>
									<div className="route-task">{taskLabels[route.task]}</div>
									<small>{route.task}</small>
								</div>
								<div className="actions">
									<Button
										type="button"
										onClick={() => addFallback(route)}
										disabled={targetOptions.length === 0}
									>
										<Plus className="icon" />
										<span>Fallback</span>
									</Button>
								</div>
							</div>
							<div className="route-target-grid">
								<div className="settings-form-field">
									<label htmlFor={`${route.task}-primary`}>Primary Model</label>
									<SelectInput
										id={`${route.task}-primary`}
										value={targetKey(route.primaryTarget)}
										onChange={(event) =>
											updateRoute(route.task, {
												primaryTarget: withThinkingDepth(
													parseTargetKey(event.target.value),
													route.primaryTarget?.thinkingDepth ?? "",
												),
											})
										}
									>
										<option value="">No primary</option>
										{targetOptions.map((option) => (
											<option key={option.key} value={option.key}>
												{option.enabled ? "" : "[disabled] "}
												{option.label}
											</option>
										))}
									</SelectInput>
								</div>
								{route.primaryTarget &&
								isThinkingModel(route.primaryTarget.model) ? (
									<div className="settings-form-field">
										<label htmlFor={`${route.task}-primary-thinking`}>
											Thinking
										</label>
										<SelectInput
											id={`${route.task}-primary-thinking`}
											value={route.primaryTarget.thinkingDepth ?? ""}
											onChange={(event) =>
												updateRoute(route.task, {
													primaryTarget: withThinkingDepth(
														route.primaryTarget ?? null,
														event.target.value as "" | LlmThinkingDepth,
													),
												})
											}
										>
											{thinkingDepthOptions.map((option) => (
												<option
													key={option.value || "auto"}
													value={option.value}
												>
													{option.label}
												</option>
											))}
										</SelectInput>
									</div>
								) : null}
							</div>
							{route.fallbackTargets.length > 0 ? (
								<div className="fallback-list">
									{route.fallbackTargets.map((fallback, index) => (
										<div
											className="fallback-row"
											key={fallbackKey(route, fallback, index)}
										>
											<div className="settings-form-field">
												<label htmlFor={`${route.task}-fallback-${index}`}>
													Fallback {index + 1}
												</label>
												<SelectInput
													id={`${route.task}-fallback-${index}`}
													value={targetKey(fallback)}
													onChange={(event) =>
														updateFallback(
															route,
															index,
															withThinkingDepth(
																parseTargetKey(event.target.value),
																fallback.thinkingDepth ?? "",
															),
														)
													}
												>
													<option value="">Remove fallback</option>
													{targetOptions.map((option) => (
														<option key={option.key} value={option.key}>
															{option.enabled ? "" : "[disabled] "}
															{option.label}
														</option>
													))}
												</SelectInput>
											</div>
											{isThinkingModel(fallback.model) ? (
												<div className="settings-form-field">
													<label
														htmlFor={`${route.task}-fallback-${index}-thinking`}
													>
														Thinking
													</label>
													<SelectInput
														id={`${route.task}-fallback-${index}-thinking`}
														value={fallback.thinkingDepth ?? ""}
														onChange={(event) =>
															updateFallback(
																route,
																index,
																withThinkingDepth(
																	fallback,
																	event.target.value as "" | LlmThinkingDepth,
																),
															)
														}
													>
														{thinkingDepthOptions.map((option) => (
															<option
																key={option.value || "auto"}
																value={option.value}
															>
																{option.label}
															</option>
														))}
													</SelectInput>
												</div>
											) : null}
											<div className="route-icon-actions">
												<Button
													type="button"
													onClick={() => moveFallback(route, index, -1)}
													disabled={index === 0}
												>
													<ArrowUp className="icon" />
												</Button>
												<Button
													type="button"
													onClick={() => moveFallback(route, index, 1)}
													disabled={index === route.fallbackTargets.length - 1}
												>
													<ArrowDown className="icon" />
												</Button>
												<Button
													type="button"
													variant="destructive"
													onClick={() => updateFallback(route, index, null)}
												>
													<X className="icon" />
												</Button>
											</div>
										</div>
									))}
								</div>
							) : null}
						</div>
					))}
				</div>
				{validationErrors.length > 0 ? (
					<div className="settings-validation">
						{validationErrors.map((error) => (
							<div key={error}>{error}</div>
						))}
					</div>
				) : null}
			</section>
		</main>
	);
}
