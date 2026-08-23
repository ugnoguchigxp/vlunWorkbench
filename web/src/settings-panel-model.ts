import type {
	CodexStatusResponse,
	LlmModelTarget,
	LlmProviderEndpoint,
	LlmProviderKind,
	LlmSettingsResponse,
	LlmTask,
	LlmTaskRoute,
	LlmThinkingDepth,
} from "./api";
import type { AppHealth, SourceHealth } from "./settings-panel-types";

export const LLM_TASKS: LlmTask[] = [
	"finding_review",
	"scan_review",
	"evidence_context",
	"agentic_search",
	"report_summary",
];

export const PROVIDER_KINDS: LlmProviderKind[] = [
	"azure",
	"openai",
	"openai-compatible",
	"bedrock",
	"local",
];

export const providerKindLabels: Record<LlmProviderKind, string> = {
	azure: "Azure OpenAI",
	openai: "OpenAI",
	"openai-compatible": "OpenAI Compatible",
	bedrock: "AWS Bedrock",
	local: "Local LLM",
	codex: "Codex SDK",
};

export const thinkingDepthOptions: Array<{
	value: "" | LlmThinkingDepth;
	label: string;
}> = [
	{ value: "", label: "自動" },
	{ value: "low", label: "低" },
	{ value: "medium", label: "中" },
	{ value: "high", label: "高" },
	{ value: "very_high", label: "最高" },
];

export const taskLabels: Record<LlmTask, string> = {
	finding_review: "Findingレビュー",
	scan_review: "スキャンレビュー",
	evidence_context: "証拠コンテキスト",
	agentic_search: "エージェント検索",
	report_summary: "レポート要約",
};

export const taskDescriptions: Record<LlmTask, string> = {
	finding_review: "個別Findingの証拠と修正要否をレビューします",
	scan_review: "スキャン全体の結果と改善点をレビューします",
	evidence_context: "Findingに関連する証拠コンテキストを生成します",
	agentic_search: "Knowledgeを使用した検索応答を生成します",
	report_summary: "診断レポートの要約を生成します",
};

export type SettingsPanelProps = {
	isAdmin: boolean;
	appHealth: AppHealth | null;
	sourceHealth: SourceHealth | null;
	systemContextText: string;
	systemContextUpdatedAt: string | null;
	systemContextSaving: boolean;
	onSystemContextTextChange: (value: string) => void;
	onSystemContextSaved: (systemContext: string, updatedAt: string) => void;
	onSystemContextSavingChange: (saving: boolean) => void;
	onDirtyChange: (dirty: boolean) => void;
};

export const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

export const sameJson = (left: unknown, right: unknown): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

export const toLlmSettingsInput = (settings: LlmSettingsResponse) => ({
	providerEndpoints: settings.providerEndpoints,
	taskRoutes: ensureRoutes(settings.taskRoutes),
});

export type ProviderStatus = {
	label:
		| "無効"
		| "認証が必要"
		| "アダプターを利用できません"
		| "接続済み"
		| "未設定"
		| "接続エラー"
		| "未確認";
	tone: "ok" | "warning" | "error" | "neutral";
};

export const deriveProviderStatus = (
	endpoint: LlmProviderEndpoint,
	codexStatus: CodexStatusResponse | null,
	health?: { ok: boolean },
): ProviderStatus => {
	if (!endpoint.enabled) return { label: "無効", tone: "neutral" };
	if (endpoint.kind === "codex") {
		if (!codexStatus) return { label: "未確認", tone: "neutral" };
		if (!codexStatus.authenticated)
			return { label: "認証が必要", tone: "warning" };
		if (!codexStatus.executableAdapterAvailable) {
			return { label: "アダプターを利用できません", tone: "error" };
		}
		return { label: "接続済み", tone: "ok" };
	}
	const missingRequired =
		(endpoint.kind === "azure" && !endpoint.endpoint?.trim()) ||
		((endpoint.kind === "openai" ||
			endpoint.kind === "openai-compatible" ||
			endpoint.kind === "local") &&
			!endpoint.baseUrl?.trim()) ||
		endpoint.models.length === 0;
	if (missingRequired) return { label: "未設定", tone: "warning" };
	if (health?.ok) return { label: "接続済み", tone: "ok" };
	if (health) return { label: "接続エラー", tone: "error" };
	return { label: "未確認", tone: "neutral" };
};

const createId = (): string =>
	typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: `endpoint-${Date.now()}`;

export const emptyEndpoint = (): LlmProviderEndpoint => ({
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
	enabled: Boolean(
		codexStatus?.authenticated && codexStatus.executableAdapterAvailable,
	),
	apiKey: "",
	baseUrl: "",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: codexStatus?.detectedModels ?? [],
	modelDisplayNames: {},
	modelCapabilities: {},
});

export const ensureCodexEndpoint = (
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
			{
				...codexEndpoint,
				models,
			},
			...settings.providerEndpoints.filter(
				(endpoint) => endpoint.kind !== "codex",
			),
		],
	};
};

export const ensureRoutes = (routes: LlmTaskRoute[]): LlmTaskRoute[] =>
	LLM_TASKS.map(
		(task) =>
			routes.find((route) => route.task === task) ?? {
				task,
				primaryTarget: null,
				fallbackTargets: [],
				policy: {},
			},
	);

export const modelText = (endpoint: LlmProviderEndpoint): string =>
	endpoint.models.join(", ");

export const parseModels = (value: string): string[] =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

export const formatModelDisplayNames = (
	value: Record<string, string>,
): string =>
	Object.entries(value)
		.map(([model, label]) => `${model}=${label}`)
		.join("\n");

export const parseModelDisplayNames = (value: string): Record<string, string> =>
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

export const isThinkingModel = (model: string): boolean => {
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

export const withThinkingDepth = (
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

export const targetKey = (target?: LlmModelTarget | null): string =>
	target ? `${target.providerEndpointId}::${target.model}` : "";

export const parseTargetKey = (value: string): LlmModelTarget | null => {
	if (!value) return null;
	const [providerEndpointId, model] = value.split("::");
	if (!providerEndpointId || !model) return null;
	return { providerEndpointId, model };
};

export const fallbackKey = (
	route: LlmTaskRoute,
	target: LlmModelTarget,
	index: number,
): string =>
	`${route.task}-${target.providerEndpointId}-${target.model}-${target.thinkingDepth ?? "auto"}-${index}`;
