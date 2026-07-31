export type SourceTreePage = {
	slug: string;
	title: string;
	path: string;
	updatedAt: string;
};

export type SourceFolder = {
	path: string;
};

export type SourceTreeResponse = {
	items: SourceTreePage[];
	folders: SourceFolder[];
};

export type SourceCategoryResponse = {
	items: string[];
};

export type SourcePage = {
	slug: string;
	title: string;
	body: string;
	path: string;
	meta: Record<string, unknown>;
};

export type SourceHealth = {
	service: string;
	git: {
		branch: string;
		commit: string;
	} | null;
};

export type SystemContextResponse = {
	systemContext: string;
	updatedAt: string;
};

export type LlmProviderKind =
	| "azure"
	| "openai"
	| "openai-compatible"
	| "bedrock"
	| "local"
	| "codex";

export type LlmTask =
	| "finding_review"
	| "scan_review"
	| "evidence_context"
	| "agentic_search"
	| "report_summary";

export type LlmThinkingDepth = "" | "low" | "medium" | "high" | "very_high";

export type LlmProviderEndpoint = {
	id: string;
	name: string;
	kind: LlmProviderKind;
	enabled: boolean;
	apiKey: string;
	baseUrl: string;
	endpoint: string;
	apiVersion: string;
	region: string;
	models: string[];
	modelDisplayNames: Record<string, string>;
	defaultModelCapability?: Record<string, unknown>;
	modelCapabilities: Record<string, Record<string, unknown>>;
};

export type LlmModelTarget = {
	providerEndpointId: string;
	model: string;
	thinkingDepth?: LlmThinkingDepth;
};

export type LlmTaskRoute = {
	task: LlmTask;
	primaryTarget?: LlmModelTarget | null;
	fallbackTargets: LlmModelTarget[];
	policy: {
		allowCodex?: boolean;
		fallbackMode?: "disabled" | "explicit";
	};
};

export type LlmSettingsResponse = {
	providerEndpoints: LlmProviderEndpoint[];
	taskRoutes: LlmTaskRoute[];
	updatedAt: string | null;
};

export type RuntimeSettingsResponse = {
	scanExecutionMode: "host" | "docker";
	allowHostScannerExecution: boolean;
	scanDockerImage: string;
	dockerMemory: string;
	dockerCpus: number;
	dockerPidsLimit: number;
	scannerStdoutLimitBytes: number;
	scannerStderrLimitBytes: number;
	codexSdkTimeoutMs: number;
	updatedAt: string | null;
};

export type LlmProviderHealthResult = {
	ok: boolean;
	reachable: boolean;
	status: string;
	url: string | null;
	message: string;
	durationMs: number;
	checkedAt: string;
};

export type CodexStatusResponse = {
	authenticated: boolean;
	authSource: "environment" | "settings" | "codex-auth-json" | "none";
	codexHome: string;
	modelSource: "settings" | "cache" | "fallback" | "none";
	detectedModels: string[];
	executableAdapterAvailable: boolean;
	adapterDiagnostics?: Record<string, unknown>;
};

export type AuthUser = {
	id: string;
	email: string;
	displayName: string;
	role: "admin" | "member";
};

export type AdminUser = AuthUser & {
	isActive: boolean;
	lastLoginAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export type SourceMutationResponse = {
	ok: true;
	slug?: string;
	path?: string;
	from?: string;
	commit: string | null;
	hash?: string;
	movedPages?: Array<{ from: string; to: string }>;
	deletedSlugs?: string[];
	reindexed?: {
		importedFiles: number;
		skippedFiles: number;
		removedSources: number;
	};
};

export type SourceReindexResponse = {
	ok: true;
	importedFiles: number;
	skippedFiles: number;
	removedSources: number;
};

export type Citation = {
	sourceId: string;
	fragmentId: string;
	uri: string;
	category: string;
	title: string;
	heading?: string;
	locator: string;
	score: number;
};

export type RetrievedFragment = {
	id: string;
	sourceId: string;
	sourceUri: string;
	sourceCategory: string;
	locator: string;
	heading: string | null;
	content: string;
	wikiSlug?: string | null;
	wikiApiPath?: string | null;
	wikiRawPath?: string | null;
	vectorScore?: number;
	textScore?: number;
	trigramScore?: number;
	sourceHitCount?: number;
	combinedScore: number;
};

export type WebSearchResult = {
	title: string;
	url: string;
	snippet: string;
	position: number;
	content?: string;
};

export type AgenticSearchCitation = {
	kind: "wiki_fragment" | "wiki_page" | "web_search_result" | "web_page";
	title: string;
	uri?: string;
	url?: string;
	locator?: string;
	wikiSlug?: string | null;
};

export type AgenticToolTrace = {
	tool: string;
	status: "ok" | "error" | "skipped";
	elapsedMs: number;
	resultCount?: number;
	message?: string;
};

export type AgenticSearchResult = {
	query: string;
	answer: string;
	citations: AgenticSearchCitation[];
	toolTrace: AgenticToolTrace[];
	retrieved?: RetrievedFragment[];
	webResults?: WebSearchResult[];
	usage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
};

export type Artifact = {
	id: string;
	type: string;
	title?: string;
	content: unknown;
	version: number;
	metadata: Record<string, unknown>;
};

export type ChatCompletionResult = {
	id: string;
	conversationId: string;
	text: string;
	citations: Citation[];
	artifacts: Artifact[];
	retrieved: RetrievedFragment[];
	webResults?: WebSearchResult[];
	usage?: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
};

export type ConversationItem = {
	id: string;
	title: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type ConversationMessage = {
	id: string;
	role: "system" | "user" | "assistant";
	content: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	artifacts: Artifact[];
};

export type RetrievalLog = {
	id: string;
	messageId: string | null;
	query: string;
	fragmentIds: string[];
	scores: unknown;
	context: unknown;
	createdAt: string;
};

export type SourceHistoryItem = {
	commit: string;
	author: string;
	date: string;
	message: string;
};
