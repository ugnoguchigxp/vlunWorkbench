import type {
	StaticIntelligenceAgentQueryKind,
	StaticIntelligenceAgentQueryResult,
} from "../../shared/schemas/static-intelligence-agent-query.schema";
import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../shared/schemas/static-intelligence-code-structure.schema";
import type {
	StaticIntelligenceModuleCandidate,
	StaticIntelligenceOntologyHandoff,
	StaticIntelligenceReadiness,
	IntelligenceReadinessStatus,
} from "../../shared/schemas/static-intelligence-module.schema";
import type { StaticIntelligenceKnowledgeSourceManifest } from "../../shared/schemas/static-intelligence-knowledge-source.schema";

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

type RequestInitJson = Omit<RequestInit, "body"> & {
	body?: unknown;
};

export const UNAUTHORIZED_EVENT_NAME = "vuln-workbench:unauthorized";

let lastUnauthorizedEventAt = 0;
let refreshRequest: Promise<boolean> | null = null;

const notifyUnauthorized = () => {
	if (typeof window === "undefined") return;
	const now = Date.now();
	if (now - lastUnauthorizedEventAt < 500) return;
	lastUnauthorizedEventAt = now;
	window.dispatchEvent(new Event(UNAUTHORIZED_EVENT_NAME));
};

const isAuthPath = (path: string): boolean => path.startsWith("/api/auth/");

const canRetryWithRefresh = (path: string): boolean =>
	!isAuthPath(path) || path === "/api/auth/me";

const shouldNotifyUnauthorized = (path: string): boolean =>
	path !== "/api/auth/login";

const parseErrorMessage = async (response: Response): Promise<string> => {
	let message = `Request failed: ${response.status}`;
	try {
		const data = (await response.json()) as { message?: string };
		if (data.message) {
			message = data.message;
		}
	} catch {
		// ignore parse errors for non-JSON responses
	}
	return message;
};

const refreshAuthSession = async (): Promise<boolean> => {
	if (!refreshRequest) {
		refreshRequest = fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "include",
		})
			.then((response) => response.ok)
			.catch(() => false)
			.finally(() => {
				refreshRequest = null;
			});
	}
	return refreshRequest;
};

async function requestJson<T>(
	path: string,
	init?: RequestInitJson,
): Promise<T> {
	const execute = async (): Promise<Response> => {
		const headers = new Headers(init?.headers);
		if (init?.body !== undefined && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}

		const { body, ...restInit } = init || {};
		return fetch(path, {
			...restInit,
			headers,
			credentials: "include",
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	};

	let response = await execute();
	if (response.status === 401 && canRetryWithRefresh(path)) {
		const refreshed = await refreshAuthSession();
		if (refreshed) {
			response = await execute();
		}
	}

	if (!response.ok) {
		if (response.status === 401 && shouldNotifyUnauthorized(path)) {
			notifyUnauthorized();
		}
		const message = await parseErrorMessage(response);
		throw new Error(message);
	}
	return (await response.json()) as T;
}

async function requestVoid(
	path: string,
	init?: RequestInitJson,
): Promise<void> {
	const execute = async (): Promise<Response> => {
		const headers = new Headers(init?.headers);
		if (init?.body !== undefined && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}

		const { body, ...restInit } = init || {};

		return fetch(path, {
			...restInit,
			headers,
			credentials: "include",
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	};

	let response = await execute();
	if (response.status === 401 && canRetryWithRefresh(path)) {
		const refreshed = await refreshAuthSession();
		if (refreshed) {
			response = await execute();
		}
	}

	if (!response.ok) {
		if (response.status === 401 && shouldNotifyUnauthorized(path)) {
			notifyUnauthorized();
		}
		const message = await parseErrorMessage(response);
		throw new Error(message);
	}
}

const pageEndpoint = (slug: string): string =>
	`/api/sources/pages/${encodeSlug(slug)}`;

const encodeSlug = (slug: string): string =>
	slug
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");

export async function fetchSourceTree(): Promise<SourceTreeResponse> {
	return requestJson("/api/sources/tree");
}

export async function fetchSourceCategories(): Promise<string[]> {
	const data = await requestJson<SourceCategoryResponse>(
		"/api/sources/categories",
	);
	return data.items;
}

export async function fetchSourceHealth(): Promise<SourceHealth> {
	return requestJson("/api/sources/health");
}

export async function fetchSystemContext(): Promise<SystemContextResponse> {
	return requestJson("/api/settings/system-context");
}

export async function updateSystemContext(
	systemContext: string,
): Promise<SystemContextResponse> {
	return requestJson("/api/settings/system-context", {
		method: "PUT",
		body: { systemContext },
	});
}

export async function fetchLlmSettings(): Promise<LlmSettingsResponse> {
	return requestJson("/api/settings/llm");
}

export async function updateLlmSettings(
	settings: Pick<LlmSettingsResponse, "providerEndpoints" | "taskRoutes">,
): Promise<LlmSettingsResponse> {
	return requestJson("/api/settings/llm", {
		method: "PUT",
		body: settings,
	});
}

export async function checkLlmProviderHealth(
	providerEndpointId: string,
): Promise<LlmProviderHealthResult> {
	return requestJson(
		`/api/settings/llm/provider-endpoints/${encodeURIComponent(providerEndpointId)}/health`,
		{ method: "POST" },
	);
}

export async function fetchCodexStatus(): Promise<CodexStatusResponse> {
	return requestJson("/api/settings/llm/codex/status");
}

export async function searchSourcePages(
	query: string,
): Promise<Array<{ slug: string; excerpt: string }>> {
	const params = new URLSearchParams({ q: query });
	const data = await requestJson<{
		items: Array<{ slug: string; excerpt: string }>;
	}>(`/api/sources/search?${params.toString()}`);
	return data.items;
}

export async function fetchSourcePage(slug: string): Promise<SourcePage> {
	return requestJson(pageEndpoint(slug));
}

export async function updateSourcePage(
	slug: string,
	params: {
		slug?: string;
		title?: string;
		body: string;
		meta?: Record<string, unknown>;
		commitMessage?: string;
	},
): Promise<SourceMutationResponse> {
	return requestJson(pageEndpoint(slug), {
		method: "PUT",
		body: {
			slug: params.slug,
			title: params.title,
			body: params.body,
			meta: params.meta,
			commitMessage: params.commitMessage,
		},
	});
}

export async function createSourcePage(params: {
	slug: string;
	title: string;
	body: string;
	meta?: Record<string, unknown>;
}): Promise<SourceMutationResponse> {
	return requestJson("/api/sources/pages", {
		method: "POST",
		body: params,
	});
}

export async function deleteSourcePage(
	slug: string,
): Promise<SourceMutationResponse> {
	return requestJson(pageEndpoint(slug), { method: "DELETE" });
}

export async function createSourceFolder(
	folderPath: string,
): Promise<SourceMutationResponse> {
	return requestJson("/api/sources/folders", {
		method: "POST",
		body: { path: folderPath },
	});
}

export async function renameSourceFolder(
	folderPath: string,
	nextPath: string,
): Promise<SourceMutationResponse> {
	return requestJson(`/api/sources/folders/${encodeSlug(folderPath)}`, {
		method: "PUT",
		body: { path: nextPath },
	});
}

export async function deleteSourceFolder(
	folderPath: string,
): Promise<SourceMutationResponse> {
	return requestJson(`/api/sources/folders/${encodeSlug(folderPath)}`, {
		method: "DELETE",
	});
}

export async function runSourceReindex(): Promise<SourceReindexResponse> {
	return requestJson("/api/sources/reindex", { method: "POST" });
}

export async function fetchSourceHistory(
	slug: string,
): Promise<SourceHistoryItem[]> {
	const data = await requestJson<{ items: SourceHistoryItem[] }>(
		`/api/sources/history/${encodeSlug(slug)}`,
	);
	return data.items;
}

export async function fetchSourceDiff(
	slug: string,
	from: string,
	to: string,
): Promise<string> {
	const query = new URLSearchParams({ from, to });
	const data = await requestJson<{ diff: string }>(
		`/api/sources/diff/${encodeSlug(slug)}?${query.toString()}`,
	);
	return data.diff;
}

export async function fetchConversations(
	limit = 50,
): Promise<ConversationItem[]> {
	const params = new URLSearchParams({ limit: String(limit) });
	const data = await requestJson<{ items: ConversationItem[] }>(
		`/api/chat/conversations?${params.toString()}`,
	);
	return data.items;
}

export async function deleteConversation(
	conversationId: string,
): Promise<{ ok: true }> {
	return requestJson<{ ok: true }>(
		`/api/chat/conversations/${conversationId}`,
		{ method: "DELETE" },
	);
}

export async function fetchConversationMessages(
	conversationId: string,
): Promise<ConversationMessage[]> {
	const data = await requestJson<{ items: ConversationMessage[] }>(
		`/api/chat/conversations/${conversationId}/messages`,
	);
	return data.items;
}

export async function fetchRetrievalLogs(
	conversationId: string,
	limit = 20,
): Promise<RetrievalLog[]> {
	const params = new URLSearchParams({ limit: String(limit) });
	const data = await requestJson<{ items: RetrievalLog[] }>(
		`/api/chat/conversations/${conversationId}/retrieval-logs?${params.toString()}`,
	);
	return data.items;
}

export async function sendChat(params: {
	conversationId?: string;
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
	topK?: number;
	category?: string;
}): Promise<ChatCompletionResult> {
	return requestJson("/api/chat", {
		method: "POST",
		body: params,
	});
}

export async function searchFragments(params: {
	query: string;
	topK?: number;
	category?: string;
}): Promise<{
	query: string;
	topK: number;
	category: string | null;
	strategy: "merged" | "text_fallback" | "legacy_retrieve";
	vectorResults: RetrievedFragment[];
	textResults: RetrievedFragment[];
	webResults: WebSearchResult[];
	webSearch: {
		available: boolean;
		provider: string | null;
		message: string | null;
		unavailableMessage: string | null;
	};
	mergedResults: RetrievedFragment[];
	selectedResults: RetrievedFragment[];
}> {
	return requestJson("/api/search", {
		method: "POST",
		body: params,
	});
}

export async function agenticSearch(params: {
	query: string;
	topK?: number;
	category?: string;
}): Promise<AgenticSearchResult> {
	return requestJson("/api/agentic-search", {
		method: "POST",
		body: params,
	});
}

export async function login(params: {
	email: string;
	password: string;
}): Promise<{ user: AuthUser }> {
	return requestJson("/api/auth/login", {
		method: "POST",
		body: params,
	});
}

export async function logout(): Promise<void> {
	await requestVoid("/api/auth/logout", {
		method: "POST",
	});
}

export async function fetchMe(): Promise<AuthUser> {
	const response = await requestJson<{ user: AuthUser }>("/api/auth/me");
	return response.user;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
	const response = await requestJson<{ items: AdminUser[] }>(
		"/api/admin/users",
	);
	return response.items;
}

export async function createAdminUser(params: {
	email: string;
	displayName: string;
	role: "admin" | "member";
	initialPassword: string;
}): Promise<AdminUser> {
	const response = await requestJson<{ user: AdminUser }>("/api/admin/users", {
		method: "POST",
		body: params,
	});
	return response.user;
}

export async function updateAdminUser(
	userId: string,
	params: { displayName?: string; role?: "admin" | "member" },
): Promise<AdminUser> {
	const response = await requestJson<{ user: AdminUser }>(
		`/api/admin/users/${userId}`,
		{
			method: "PATCH",
			body: params,
		},
	);
	return response.user;
}

export async function disableAdminUser(userId: string): Promise<AdminUser> {
	const response = await requestJson<{ user: AdminUser }>(
		`/api/admin/users/${userId}/disable`,
		{
			method: "POST",
		},
	);
	return response.user;
}

export async function enableAdminUser(userId: string): Promise<AdminUser> {
	const response = await requestJson<{ user: AdminUser }>(
		`/api/admin/users/${userId}/enable`,
		{
			method: "POST",
		},
	);
	return response.user;
}

export async function resetAdminUserPassword(
	userId: string,
	newPassword: string,
): Promise<void> {
	await requestVoid(`/api/admin/users/${userId}/reset-password`, {
		method: "POST",
		body: { newPassword },
	});
}

// --- Phase 1: CLI Scan Foundation Types ---

export type Project = {
	id: string;
	ownerUserId: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type ScanRun = {
	id: string;
	projectId: string;
	profile: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	startedAt: string | null;
	completedAt: string | null;
	createdByUserId: string | null;
	summary: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type ScanEvent = {
	id: string;
	scanRunId: string;
	level: "debug" | "info" | "warn" | "error";
	eventType: string;
	message: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export type ScanArtifact = {
	id: string;
	scanRunId: string;
	toolRunId: string | null;
	kind:
		| "raw_result"
		| "stdout"
		| "stderr"
		| "log"
		| "normalized_result"
		| "source_snippet";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type FindingDecision = {
	id: string;
	findingId: string;
	decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
	reason:
		| "confirmed_by_evidence"
		| "confirmed_by_review"
		| "insufficient_evidence"
		| "environment_specific"
		| "tool_noise"
		| "not_exploitable"
		| "accepted_risk"
		| "other";
	comment: string | null;
	linkedReviewId: string | null;
	decidedByUserId: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type Finding = {
	id: string;
	scanRunId: string;
	projectId: string;
	sourceTool: string;
	ruleId: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	confidence: "static";
	status: "open";
	primaryLocation: Record<string, unknown> | null;
	fingerprint: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	latestDecision?: FindingDecision | null;
	latestReview?: Partial<FindingReview> | null;
};

export type FindingEvidence = {
	id: string;
	findingId: string;
	kind: "tool-output" | "source-location" | "scan-log";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

// --- Phase 1: CLI Scan Foundation API functions ---

export async function fetchProjects(): Promise<Project[]> {
	const data = await requestJson<{ projects: Project[] }>("/api/projects");
	return data.projects;
}

export async function fetchProject(projectId: string): Promise<Project> {
	const data = await requestJson<{ project: Project }>(
		`/api/projects/${projectId}`,
	);
	return data.project;
}

export async function createProject(params: {
	name: string;
	repoPath: string;
	defaultBranch?: string;
	metadata?: Record<string, unknown>;
}): Promise<Project> {
	const data = await requestJson<{ project: Project }>("/api/projects", {
		method: "POST",
		body: params,
	});
	return data.project;
}

export async function browseProjectFolder(): Promise<{ path: string | null }> {
	return requestJson<{ path: string | null }>("/api/projects/folder-picker", {
		method: "POST",
	});
}

export async function fetchScans(projectId: string): Promise<ScanRun[]> {
	const params = new URLSearchParams({ projectId });
	const data = await requestJson<{ scans: ScanRun[] }>(
		`/api/scans?${params.toString()}`,
	);
	return [...data.scans].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function fetchScan(scanRunId: string): Promise<ScanRun> {
	const data = await requestJson<{ scan: ScanRun }>(`/api/scans/${scanRunId}`);
	return data.scan;
}

export async function fetchScanEvents(scanRunId: string): Promise<ScanEvent[]> {
	const data = await requestJson<{ events: ScanEvent[] }>(
		`/api/scans/${scanRunId}/events`,
	);
	return data.events;
}

export async function cancelScan(scanRunId: string): Promise<ScanRun> {
	const data = await requestJson<{ scan: ScanRun }>(
		`/api/scans/${scanRunId}/cancel`,
		{ method: "POST" },
	);
	return data.scan;
}

export async function fetchScanArtifacts(
	scanRunId: string,
): Promise<ScanArtifact[]> {
	const data = await requestJson<{ artifacts: ScanArtifact[] }>(
		`/api/scans/${scanRunId}/artifacts`,
	);
	return data.artifacts;
}

export async function fetchScanFindings(scanRunId: string): Promise<Finding[]> {
	const data = await requestJson<{ findings: Finding[] }>(
		`/api/scans/${scanRunId}/findings`,
	);
	return data.findings;
}

export type ProjectIntelligenceView = {
	project: ProjectIntelligenceProject;
	latestUsableScan: ScanRun | null;
	selectedScan: ScanRun | null;
	selection: {
		requestedScanRunId: string | null;
		selectedScanRunId: string | null;
		isLatest: boolean;
		selectionReason:
			| "requested"
			| "latest_completed"
			| "latest_terminal_degraded"
			| "none";
	};
	generation: {
		generationId: string;
		generatedAt: string;
		sourceTreeHash: string;
		sourceStateHash: string;
		snapshotRef?: string;
		exportHash: string;
		status: IntelligenceReadinessStatus;
	} | null;
	export: StaticIntelligenceExportV1 | null;
	manifest: StaticIntelligenceKnowledgeSourceManifest | null;
	readiness: StaticIntelligenceReadiness;
	degradedReasons: string[];
};

export type ProjectIntelligenceSummary = {
	project: ProjectIntelligenceProject;
	projectId: string;
	selectedScanRunId: string | null;
	scanStatus: string | null;
	riskBand: string;
	evidenceQuality: string;
	findingCount: number;
	codeStructureStatus: IntelligenceReadinessStatus;
	generationStatus: IntelligenceReadinessStatus;
	generatedAt: string | null;
	degradedReasonCount: number;
};

export type ProjectIntelligenceProject = {
	id: string;
	name: string;
	repositoryName: string;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
};

export type ProjectStructureListResponse = {
	status: IntelligenceReadinessStatus | "available" | "degraded";
	generationId?: string;
	items: Array<{
		path: string;
		language: string;
		moduleKind: string;
		tags: string[];
		parseStatus: string;
		importCount: number;
		exportCount: number;
		packageCount: number;
		risk: FileRiskIndexEntry | null;
	}>;
	modules: StaticIntelligenceModuleCandidate[];
	nextCursor: number | null;
	total?: number;
};

export type ScanIntelligenceExportResponse = {
	export: StaticIntelligenceExportV1;
};

export type ScanIntelligenceAgentMode =
	| "overview"
	| "risk"
	| "evidence"
	| "verification"
	| "export";

export type ScanIntelligenceAgentQueryResponse = {
	result: StaticIntelligenceAgentQueryResult;
};

export type ScanCodeStructureResponse = {
	scanRunId: string;
	generationId?: string;
	status: "available" | "missing" | "degraded";
	snapshot: CodeStructureSnapshot | null;
	degradedReasons: string[];
};

export const agentModeToQueryKind: Record<
	ScanIntelligenceAgentMode,
	StaticIntelligenceAgentQueryKind
> = {
	overview: "project_overview",
	risk: "risk_context",
	evidence: "evidence_bundle",
	verification: "verification_commands",
	export: "export_static_intelligence",
};

export async function fetchProjectIntelligenceView(
	projectId: string,
	scanRunId?: string | null,
): Promise<ProjectIntelligenceView> {
	const search = new URLSearchParams();
	if (scanRunId) search.set("scanRunId", scanRunId);
	return requestJson<ProjectIntelligenceView>(
		`/api/projects/${projectId}/intelligence${search.size ? `?${search.toString()}` : ""}`,
	);
}

export async function fetchProjectIntelligenceSummaries(): Promise<
	ProjectIntelligenceSummary[]
> {
	const data = await requestJson<{ summaries: ProjectIntelligenceSummary[] }>(
		"/api/projects/intelligence-summaries",
	);
	return data.summaries;
}

export async function fetchProjectIntelligenceStructure(
	projectId: string,
	scanRunId: string,
	params: {
		generationId?: string;
		query?: string;
		tag?: string;
		status?: string;
		cursor?: number;
		limit?: number;
	} = {},
): Promise<ProjectStructureListResponse> {
	const search = new URLSearchParams({ scanRunId });
	for (const [key, value] of Object.entries(params))
		if (value !== undefined && value !== "") search.set(key, String(value));
	return requestJson<ProjectStructureListResponse>(
		`/api/projects/${projectId}/intelligence/structure?${search.toString()}`,
	);
}

export async function fetchProjectOntologyHandoff(
	projectId: string,
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceOntologyHandoff | null> {
	const data = await requestJson<{
		handoff: StaticIntelligenceOntologyHandoff | null;
	}>(
		`/api/projects/${projectId}/intelligence/ontology-handoff?${new URLSearchParams(
			{
				scanRunId,
				...(generationId ? { generationId } : {}),
			},
		).toString()}`,
	);
	return data.handoff;
}

export async function refreshProjectIntelligence(
	projectId: string,
	scanRunId: string,
	includeSemantic = false,
): Promise<{ ok: true; status: "completed" | "partial" }> {
	return requestJson(`/api/projects/${projectId}/intelligence/refresh`, {
		method: "POST",
		body: { scanRunId, includeSemantic },
	});
}

export async function fetchScanIntelligenceExport(
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceExportV1> {
	const search = generationId
		? `?${new URLSearchParams({ generationId }).toString()}`
		: "";
	const data = await requestJson<ScanIntelligenceExportResponse>(
		`/api/scans/${scanRunId}/intelligence/export${search}`,
	);
	return data.export;
}

export async function fetchScanIntelligenceAgentQuery(
	scanRunId: string,
	params: {
		mode: ScanIntelligenceAgentMode;
		generationId?: string;
		query?: string;
		findingId?: string;
		file?: string;
		ruleId?: string;
		scanner?: string;
	},
): Promise<StaticIntelligenceAgentQueryResult> {
	const search = new URLSearchParams({ mode: params.mode });
	for (const key of [
		"generationId",
		"query",
		"findingId",
		"file",
		"ruleId",
		"scanner",
	] as const) {
		const value = params[key];
		if (value) search.set(key, value);
	}
	const data = await requestJson<ScanIntelligenceAgentQueryResponse>(
		`/api/scans/${scanRunId}/intelligence/agent-query?${search.toString()}`,
	);
	return data.result;
}

export async function fetchScanCodeStructure(
	scanRunId: string,
	generationId?: string,
): Promise<ScanCodeStructureResponse> {
	const search = generationId
		? `?${new URLSearchParams({ generationId }).toString()}`
		: "";
	return requestJson<ScanCodeStructureResponse>(
		`/api/scans/${scanRunId}/intelligence/code-structure${search}`,
	);
}

export type FindingReview = {
	id: string;
	findingId: string;
	provider: string;
	model: string;
	status: "running" | "completed" | "failed";
	summary: string | null;
	likelyImpact: string | null;
	falsePositiveAssessment: {
		level: "low" | "medium" | "high" | "unknown";
		reasoning: string;
	} | null;
	evidenceStrength: {
		level: "weak" | "moderate" | "strong" | "unknown";
		reasoning: string;
	} | null;
	remediationDirection: string | null;
	reviewerNotes: string[] | null;
	confidenceAdjustment: "unchanged" | "increase" | "decrease" | "unknown";
	inputBundle: Record<string, unknown> | null;
	output: Record<string, unknown> | null;
	errorMessage: string | null;
	createdByUserId: string | null;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export async function fetchFinding(findingId: string): Promise<{
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
}> {
	return requestJson<{
		finding: Finding;
		evidence: FindingEvidence[];
		latestReview: FindingReview | null;
		latestDecision: FindingDecision | null;
	}>(`/api/findings/${findingId}`);
}

export async function fetchFindingReviews(
	findingId: string,
): Promise<{ reviews: FindingReview[] }> {
	return requestJson<{ reviews: FindingReview[] }>(
		`/api/findings/${findingId}/reviews`,
	);
}

export async function triggerFindingReview(findingId: string): Promise<{
	ok: boolean;
	reviewId: string;
	status: "completed" | "failed";
	error?: string;
}> {
	return requestJson<{
		ok: boolean;
		reviewId: string;
		status: "completed" | "failed";
		error?: string;
	}>(`/api/findings/${findingId}/reviews`, {
		method: "POST",
	});
}

export async function fetchFindingReview(
	reviewId: string,
): Promise<{ review: FindingReview }> {
	return requestJson<{ review: FindingReview }>(
		`/api/finding-reviews/${reviewId}`,
	);
}

export async function fetchFindingDecisions(
	findingId: string,
): Promise<{ decisions: FindingDecision[] }> {
	return requestJson<{ decisions: FindingDecision[] }>(
		`/api/findings/${findingId}/decisions`,
	);
}

export async function createFindingDecision(
	findingId: string,
	params: {
		decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
		reason: string;
		comment?: string;
		linkedReviewId?: string;
		metadata?: Record<string, unknown>;
	},
): Promise<{ decision: FindingDecision }> {
	return requestJson<{ decision: FindingDecision }>(
		`/api/findings/${findingId}/decisions`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function fetchFindingDecision(
	decisionId: string,
): Promise<{ decision: FindingDecision }> {
	return requestJson<{ decision: FindingDecision }>(
		`/api/finding-decisions/${decisionId}`,
	);
}

// --- Phase 5: Markdown Report Export API functions ---

export type ScanReport = {
	id: string;
	scanRunId: string;
	artifactId: string | null;
	format: string;
	title: string;
	summary: string | null;
	options: {
		includeFalsePositives: boolean;
		includeDeferred: boolean;
		includeUndecided: boolean;
		summaryMode?: "deterministic" | "deterministic_with_llm_summary";
		providerRouting?: Record<string, unknown>;
	};
	status: "running" | "completed" | "failed";
	errorMessage: string | null;
	generatedByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CreateScanReportInput = {
	format: string;
	title: string;
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
	summaryMode?: "deterministic" | "deterministic_with_llm_summary";
};

export async function generateScanReport(
	scanRunId: string,
	input: CreateScanReportInput,
): Promise<{ report: ScanReport }> {
	return requestJson<{ report: ScanReport }>(
		`/api/scans/${scanRunId}/reports`,
		{
			method: "POST",
			body: input,
		},
	);
}

export type ScanReview = {
	id: string;
	scanRunId: string;
	projectId: string;
	provider: string;
	model: string;
	status: "running" | "completed" | "failed";
	summary: string | null;
	riskOverview: string | null;
	priorityNotes: string[];
	coverageNotes: string[];
	falsePositiveHotspots: string[];
	recommendedNextActions: string[];
	findingTriageHints: Array<Record<string, unknown>>;
	confidenceNotes: string[];
	output?: Record<string, unknown>;
	errorMessage: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
};

export type ScanImprovementRequest = {
	title: string;
	objective: string;
	scope: string[];
	priorityPlan: Array<{
		priority: "critical" | "high" | "medium" | "low";
		rationale: string;
		findingIds: string[];
	}>;
	implementationTasks: Array<{
		title: string;
		body: string;
		findingIds: string[];
		evidenceRefs: string[];
	}>;
	acceptanceCriteria: string[];
	verificationCommands: string[];
	constraints: string[];
	nonGoals: string[];
	handoffPrompt: string;
};

export type ScanReviewFindingFilter =
	| "all"
	| "high_or_critical"
	| "weak_or_missing_evidence"
	| "new_or_regressed";

export async function fetchScanReviews(
	scanRunId: string,
): Promise<ScanReview[]> {
	const data = await requestJson<{ reviews: ScanReview[] }>(
		`/api/scans/${scanRunId}/reviews`,
	);
	return [...data.reviews].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function triggerScanReview(
	scanRunId: string,
	input: { findingFilter?: ScanReviewFindingFilter } = {},
): Promise<{ review: ScanReview | null; result: Record<string, unknown> }> {
	return requestJson<{
		review: ScanReview | null;
		result: Record<string, unknown>;
	}>(`/api/scans/${scanRunId}/reviews`, { method: "POST", body: input });
}

export async function fetchScanReports(
	scanRunId: string,
): Promise<ScanReport[]> {
	const data = await requestJson<{ reports: ScanReport[] }>(
		`/api/scans/${scanRunId}/reports`,
	);
	return [...data.reports].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function fetchScanReport(
	reportId: string,
): Promise<{ report: ScanReport }> {
	return requestJson<{ report: ScanReport }>(`/api/scan-reports/${reportId}`);
}

export type ScanProfileTool = {
	toolId: string;
	displayName: string;
	required: boolean;
	timeoutSec?: number;
};

export type ScanProfileStep =
	| {
			kind: "static_tool";
			toolId: string;
			displayName: string;
			required: boolean;
			timeoutSec?: number;
			failurePolicy: "fail_profile" | "warn_and_continue";
	  }
	| {
			kind: "dast";
			profileId: "http-baseline";
			displayName: string;
			required: boolean;
			timeoutSec?: number;
			failurePolicy: "fail_profile" | "warn_and_continue";
			target: { mode: "auto_project_start" };
	  };

export type ScanProfileScope = {
	intent: "source" | "dependency_manifest" | "artifact" | "full_deep";
	includeGenerated: boolean;
	includeInstalledDependencies: boolean;
	includeVendoredDependencies: boolean;
	notes?: string;
};

export type ScanProfile = {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	defaultTimeoutSec: number;
	scope?: ScanProfileScope;
	tools: ScanProfileTool[];
	steps?: ScanProfileStep[];
};

export type ToolSummary = {
	toolId: string;
	toolRunId: string | null;
	status: string;
	required: boolean;
	exitCode: number | null;
	findingCount: number;
	severityCounts: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
		unknown: number;
	};
	artifactCount: number;
	error: string | null;
};

export type StepSummary = {
	kind:
		| "static_tool"
		| "dast"
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	id: string;
	displayName: string;
	status: string;
	required: boolean;
	findingCount: number;
	artifactCount: number;
	error: string | null;
	outcome?: string | null;
	targetOrigin?: string | null;
	applicability?: "applicable" | "not_applicable";
	reasonCode?: string | null;
	coverageEffect?: "covered" | "partial" | "gap";
};

export type ScanStartToolResult = {
	toolId: string;
	toolRunId: string | null;
	status: string;
	exitCode: number | null;
	findingCount: number;
	error: string | null;
};

export type ScanStartCoverageStepResult = {
	kind:
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	stepId: string;
	adapter: string;
	required: boolean;
	status: string;
	applicability: "applicable" | "not_applicable";
	reasonCode: string | null;
	coverageEffect: "covered" | "partial" | "gap";
	findingCount: number;
	error: string | null;
	artifactIds?: string[];
};

export type ScanStartStepResult =
	| (ScanStartToolResult & {
			kind: "static_tool";
			required: boolean;
	  })
	| {
			kind: "dast";
			profileId: string;
			required: boolean;
			status: string;
			outcome: string | null;
			findingCount: number;
			dastRunId: string | null;
			targetOrigin: string | null;
			error: string | null;
			autoTarget?: {
				scriptName: string;
				command: string[];
				port: number;
				origin: string;
				warnings: string[];
			};
	  }
	| ScanStartCoverageStepResult;

export type ScanRunSummary = {
	scanRunId: string;
	profileId: string;
	profileOutcome: string;
	tools: ToolSummary[];
	steps?: StepSummary[];
	totals: {
		findingCount: number;
		artifactCount: number;
		reviewedFindingCount: number;
		decidedFindingCount: number;
	};
};

export type FindingGroup = {
	id: string;
	groupKey: string;
	title: string;
	severity: string;
	findingIds: string[];
	sourceTools: string[];
	metadata: {
		strategy: string;
	};
};

export type GroupedFindingsResult = {
	groups: FindingGroup[];
};

export type AttackSurfaceItem = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	category: string;
	name: string;
	kind: string;
	locationJson: Record<string, unknown>;
	boundaryJson: Record<string, unknown>;
	evidenceRefsJson: Array<Record<string, unknown>>;
	confidence: "high" | "medium" | "low";
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type SecurityCheckResult = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	checkId: string;
	attackSurfaceItemId: string | null;
	status:
		| "pass"
		| "fail"
		| "warn"
		| "not_applicable"
		| "manual_review"
		| "not_checked";
	outcome: string | null;
	title: string;
	summary: string;
	evidenceRefsJson: Array<Record<string, unknown>>;
	remediationHint: string | null;
	coverageGap: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type DiagnosticReport = {
	id: string;
	projectId: string;
	scanRunId: string;
	reportKind: "zero-finding";
	status: "running" | "completed" | "failed";
	summary: string | null;
	checkedCategoriesJson: Array<Record<string, unknown>>;
	coverageGapsJson: Array<Record<string, unknown>>;
	residualRisksJson: Array<Record<string, unknown>>;
	recommendedNextActionsJson: Array<Record<string, unknown>>;
	artifactId: string | null;
	metadata: Record<string, unknown>;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

export async function fetchScanProfiles(): Promise<ScanProfile[]> {
	const data = await requestJson<{ profiles: ScanProfile[] }>(
		"/api/scan-profiles",
	);
	return data.profiles;
}

export async function startScan(
	projectId: string,
	params: {
		profile: string;
		continueOnToolFailure?: boolean;
		timeoutSec?: number;
		runner?: "host" | "docker";
		dockerBin?: string;
		dockerImage?: string;
		network?: "none" | "default";
		memory?: string;
		cpus?: string;
		toolCacheDir?: string;
		imageRef?: string;
		imageTar?: string;
	},
): Promise<{
	scan: { id: string; status: string; profile: string };
	runner?: "host" | "docker";
	profileOutcome: string;
	message?: string;
	toolResults: ScanStartToolResult[];
	stepResults?: ScanStartStepResult[];
}> {
	return requestJson<{
		scan: { id: string; status: string; profile: string };
		runner?: "host" | "docker";
		profileOutcome: string;
		message?: string;
		toolResults: ScanStartToolResult[];
		stepResults?: ScanStartStepResult[];
	}>(`/api/projects/${projectId}/scans`, {
		method: "POST",
		body: params,
	});
}

export async function fetchScanSummary(
	scanRunId: string,
): Promise<ScanRunSummary> {
	const data = await requestJson<{ summary: ScanRunSummary }>(
		`/api/scans/${scanRunId}/summary`,
	);
	return data.summary;
}

export async function fetchScanGroups(
	scanRunId: string,
): Promise<GroupedFindingsResult> {
	return requestJson<GroupedFindingsResult>(`/api/scans/${scanRunId}/groups`);
}

export async function fetchScanAttackSurface(
	scanRunId: string,
): Promise<{ items: AttackSurfaceItem[] }> {
	return requestJson<{ items: AttackSurfaceItem[] }>(
		`/api/scans/${scanRunId}/attack-surface`,
	);
}

export async function runScanAttackSurfaceInventory(
	scanRunId: string,
): Promise<{
	ok: boolean;
	inventoryCount: number;
	categories: Record<string, number>;
}> {
	return requestJson<{
		ok: boolean;
		inventoryCount: number;
		categories: Record<string, number>;
	}>(`/api/scans/${scanRunId}/attack-surface/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanSecurityChecks(
	scanRunId: string,
): Promise<{ results: SecurityCheckResult[] }> {
	return requestJson<{ results: SecurityCheckResult[] }>(
		`/api/scans/${scanRunId}/security-checks`,
	);
}

export async function runScanSecurityChecks(scanRunId: string): Promise<{
	ok: boolean;
	resultCount: number;
	statusCounts: Record<string, number>;
}> {
	return requestJson<{
		ok: boolean;
		resultCount: number;
		statusCounts: Record<string, number>;
	}>(`/api/scans/${scanRunId}/security-checks/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanDiagnosticReports(
	scanRunId: string,
): Promise<{ reports: DiagnosticReport[] }> {
	return requestJson<{ reports: DiagnosticReport[] }>(
		`/api/scans/${scanRunId}/diagnostic-reports`,
	);
}

export async function generateDiagnosticReport(scanRunId: string): Promise<{
	ok: boolean;
	reportId: string;
	artifactId: string | null;
	status: string;
	summary: string;
}> {
	return requestJson<{
		ok: boolean;
		reportId: string;
		artifactId: string | null;
		status: string;
		summary: string;
	}>(`/api/scans/${scanRunId}/diagnostic-reports`, {
		method: "POST",
		body: { kind: "zero-finding" },
	});
}

// --- Phase 11 DAST API types and functions ---

export type DastProfile = {
	id: "http-baseline" | "browser-smoke" | "form-baseline";
	displayName: string;
	description: string;
	kind: "http" | "browser" | "form";
	enabled: boolean;
	checks: string[];
	crawlerEnabled: false;
	requiresRoutes: boolean;
	requiresForms: boolean;
};

export type DastTargetConfig = {
	id: string;
	projectId: string;
	name: string;
	origin: string;
	normalizedOrigin: string;
	enabled: boolean;
	allowLoopback: boolean;
	allowPrivateNetwork: boolean;
	allowedPathsJson: string[];
	excludedPathsJson: string[];
	defaultHeadersJson: Record<string, string>;
	maxDepth: number;
	maxRequests: number;
	rateLimitPerSec: number;
	timeoutSec: number;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastProfileConfig = {
	id: string;
	projectId: string;
	targetConfigId: string;
	profileId: string;
	displayName: string;
	enabled: boolean;
	routePathsJson: string[];
	formSelectorsJson: string[];
	checkOptionsJson: Record<string, unknown>;
	timeoutSec: number | null;
	maxRequests: number | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastRun = {
	id: string;
	projectId: string;
	scanRunId: string;
	targetConfigId: string;
	profileConfigId: string | null;
	profileId: string;
	dastKind: "http" | "browser" | "form";
	targetOrigin: string;
	runnerOrigin: string;
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome:
		| "passed"
		| "findings"
		| "failed"
		| "timed_out"
		| "inconclusive"
		| "error"
		| null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastArtifact = {
	id: string;
	dastRunId: string;
	projectId: string;
	scanRunId: string;
	kind:
		| "raw_result"
		| "http_log"
		| "browser_console"
		| "browser_network"
		| "screenshot"
		| "stdout"
		| "stderr"
		| "summary";
	format: "json" | "text" | "png" | "markdown";
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type DastEvidence = {
	id: string;
	dastRunId: string;
	projectId: string;
	scanRunId: string;
	findingId: string | null;
	kind:
		| "http-response"
		| "http-header"
		| "cookie-attribute"
		| "cors-policy"
		| "browser-console"
		| "browser-network"
		| "screenshot"
		| "dast-result";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type SaveDastTargetInput = {
	name: string;
	origin: string;
	enabled?: boolean;
	allowLoopback?: boolean;
	allowPrivateNetwork?: boolean;
	allowedPathsJson?: string[];
	excludedPathsJson?: string[];
	defaultHeadersJson?: Record<string, string>;
	maxDepth?: number;
	maxRequests?: number;
	rateLimitPerSec?: number;
	timeoutSec?: number;
	metadata?: Record<string, unknown>;
};

export type SaveDastProfileInput = {
	targetConfigId: string;
	profileId: string;
	displayName: string;
	enabled?: boolean;
	routePathsJson?: string[];
	formSelectorsJson?: string[];
	checkOptionsJson?: Record<string, unknown>;
	timeoutSec?: number | null;
	maxRequests?: number | null;
	metadata?: Record<string, unknown>;
};

export async function fetchProjectDastTargets(
	projectId: string,
): Promise<{ targets: DastTargetConfig[] }> {
	return requestJson<{ targets: DastTargetConfig[] }>(
		`/api/projects/${projectId}/dast-targets`,
	);
}

export async function saveProjectDastTarget(
	projectId: string,
	input: SaveDastTargetInput,
): Promise<{ target: DastTargetConfig; validation: unknown }> {
	return requestJson<{ target: DastTargetConfig; validation: unknown }>(
		`/api/projects/${projectId}/dast-targets`,
		{ method: "POST", body: input },
	);
}

export async function updateProjectDastTarget(
	projectId: string,
	targetConfigId: string,
	input: Partial<SaveDastTargetInput>,
): Promise<{ target: DastTargetConfig; validation: unknown }> {
	return requestJson<{ target: DastTargetConfig; validation: unknown }>(
		`/api/projects/${projectId}/dast-targets/${targetConfigId}`,
		{ method: "PATCH", body: input },
	);
}

export async function fetchProjectDastProfiles(
	projectId: string,
): Promise<{ profiles: DastProfile[]; configs: DastProfileConfig[] }> {
	return requestJson<{ profiles: DastProfile[]; configs: DastProfileConfig[] }>(
		`/api/projects/${projectId}/dast-profiles`,
	);
}

export async function saveProjectDastProfile(
	projectId: string,
	input: SaveDastProfileInput,
): Promise<{ config: DastProfileConfig }> {
	return requestJson<{ config: DastProfileConfig }>(
		`/api/projects/${projectId}/dast-profiles`,
		{ method: "POST", body: input },
	);
}

export async function fetchProjectDastRuns(
	projectId: string,
): Promise<{ dastRuns: DastRun[] }> {
	return requestJson<{ dastRuns: DastRun[] }>(
		`/api/projects/${projectId}/dast-runs`,
	);
}

export async function triggerProjectDastRun(
	projectId: string,
	input: {
		targetConfigId?: string;
		autoTarget?: boolean;
		profileId: string;
		profileConfigId?: string;
		scanRunId?: string;
		runner?: "host" | "docker" | "mock";
		dockerImage?: string;
		timeoutSec?: number;
		maxRequests?: number;
		dryRun?: boolean;
	},
): Promise<{
	ok: boolean;
	dastRunId: string | null;
	scanRunId: string | null;
	status: string;
	outcome: string | null;
	summary?: string;
	message?: string;
	plan?: {
		autoTarget?: {
			origin?: string;
			command?: string[];
			scriptName?: string;
			port?: number;
			warnings?: string[];
		};
	};
}> {
	return requestJson(`/api/projects/${projectId}/dast-runs`, {
		method: "POST",
		body: input,
	});
}

export async function fetchDastRunArtifacts(
	dastRunId: string,
): Promise<{ artifacts: DastArtifact[]; evidence: DastEvidence[] }> {
	return requestJson<{ artifacts: DastArtifact[]; evidence: DastEvidence[] }>(
		`/api/dast-runs/${dastRunId}/artifacts`,
	);
}

// --- Phase 9 Sandbox Reproduction API types and functions ---

export type ReproductionProfile = {
	id: string;
	displayName: string;
	description: string;
	sourceTools: string[];
	defaultTimeoutSec: number;
	defaultNetworkMode: "none" | "default";
	isApplicable: boolean;
	applicabilityReason: string | null;
};

export type ReproductionRun = {
	id: string;
	projectId: string;
	scanRunId: string;
	findingId: string;
	profileId: string;
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome: "reproduced" | "not_reproduced" | "inconclusive" | "error" | null;
	runner: string;
	commandJson: string[] | null;
	exitCode: number | null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, any>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ReproductionArtifact = {
	id: string;
	reproductionRunId: string;
	findingId: string;
	kind: "raw_result" | "stdout" | "stderr" | "log" | "summary";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, any>;
	createdAt: string;
};

export type ReproductionEvidence = {
	id: string;
	reproductionRunId: string;
	findingId: string;
	kind: "reproduction-result" | "reproduction-log" | "tool-output";
	title: string;
	artifactId: string | null;
	location: Record<string, any> | null;
	snippet: string | null;
	metadata: Record<string, any>;
	createdAt: string;
};

export async function fetchReproductionProfiles(
	findingId: string,
): Promise<{ profiles: ReproductionProfile[] }> {
	return requestJson<{ profiles: ReproductionProfile[] }>(
		`/api/findings/${findingId}/reproduction-profiles`,
	);
}

export async function fetchFindingReproductions(
	findingId: string,
): Promise<{ reproductions: ReproductionRun[] }> {
	return requestJson<{ reproductions: ReproductionRun[] }>(
		`/api/findings/${findingId}/reproductions`,
	);
}

export async function triggerFindingReproduction(
	findingId: string,
	params: {
		profileId: string;
		runner?: "docker";
		dockerImage?: string;
		network?: "none" | "default";
		timeoutSec?: number;
		memory?: string;
		cpus?: string;
	},
): Promise<any> {
	return requestJson<any>(`/api/findings/${findingId}/reproductions`, {
		method: "POST",
		body: params,
	});
}

export async function fetchReproductionRun(
	reproductionRunId: string,
): Promise<{ reproductionRun: ReproductionRun }> {
	return requestJson<{ reproductionRun: ReproductionRun }>(
		`/api/reproduction-runs/${reproductionRunId}`,
	);
}

export async function fetchReproductionRunArtifacts(
	reproductionRunId: string,
): Promise<{
	artifacts: ReproductionArtifact[];
	evidence: ReproductionEvidence[];
}> {
	return requestJson<{
		artifacts: ReproductionArtifact[];
		evidence: ReproductionEvidence[];
	}>(`/api/reproduction-runs/${reproductionRunId}/artifacts`);
}

// --- Phase 10 Dynamic Verification API types and functions ---

export type DynamicProfileConfig = {
	id: string;
	projectId: string;
	profileId: string;
	dynamicKind: "test" | "sanitizer" | "fuzz";
	displayName: string;
	enabled: boolean;
	commandJson: string[];
	workingDirectory: string;
	timeoutSec: number;
	network: string;
	memory: string | null;
	cpus: string | null;
	writableWorkdir: boolean;
	allowProjectScripts: boolean;
	expectedArtifactsJson: string[];
	metadata: Record<string, any>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DynamicRun = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	findingId: string | null;
	profileConfigId: string;
	profileId: string;
	dynamicKind: "test" | "sanitizer" | "fuzz";
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome:
		| "passed"
		| "failed"
		| "crashed"
		| "timed_out"
		| "inconclusive"
		| "error"
		| null;
	runner: string;
	commandJson: string[];
	exitCode: number | null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, any>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DynamicArtifact = {
	id: string;
	dynamicRunId: string;
	projectId: string;
	findingId: string | null;
	kind:
		| "stdout"
		| "stderr"
		| "log"
		| "crash"
		| "summary"
		| "coverage"
		| "raw_result";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, any>;
	createdAt: string;
};

export type DynamicEvidence = {
	id: string;
	dynamicRunId: string;
	projectId: string;
	findingId: string | null;
	kind:
		| "dynamic-test-log"
		| "sanitizer-finding"
		| "fuzz-crash"
		| "dynamic-result";
	title: string;
	artifactId: string | null;
	location: Record<string, any> | null;
	snippet: string | null;
	metadata: Record<string, any>;
	createdAt: string;
};

export async function fetchProjectDynamicProfiles(
	projectId: string,
): Promise<{ configs: DynamicProfileConfig[] }> {
	return requestJson<{ configs: DynamicProfileConfig[] }>(
		`/api/projects/${projectId}/dynamic-profiles`,
	);
}

export async function saveProjectDynamicProfile(
	projectId: string,
	params: Partial<DynamicProfileConfig> & {
		profileId: string;
		dynamicKind: string;
		displayName: string;
		commandJson: string[];
	},
): Promise<{ config: DynamicProfileConfig }> {
	return requestJson<{ config: DynamicProfileConfig }>(
		`/api/projects/${projectId}/dynamic-profiles`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function updateProjectDynamicProfile(
	projectId: string,
	profileId: string,
	params: Partial<DynamicProfileConfig>,
): Promise<{ config: DynamicProfileConfig }> {
	return requestJson<{ config: DynamicProfileConfig }>(
		`/api/projects/${projectId}/dynamic-profiles/${profileId}`,
		{
			method: "PATCH",
			body: params,
		},
	);
}

export async function fetchProjectDynamicRuns(
	projectId: string,
): Promise<{ dynamicRuns: DynamicRun[] }> {
	return requestJson<{ dynamicRuns: DynamicRun[] }>(
		`/api/projects/${projectId}/dynamic-runs`,
	);
}

export async function triggerProjectDynamicRun(
	projectId: string,
	params: {
		profileId: string;
		runner?: "docker";
		dockerImage?: string;
		network?: "none" | "default";
		timeoutSec?: number;
		memory?: string;
		cpus?: string;
	},
): Promise<any> {
	return requestJson<any>(`/api/projects/${projectId}/dynamic-runs`, {
		method: "POST",
		body: params,
	});
}

export async function fetchFindingDynamicRuns(
	findingId: string,
): Promise<{ dynamicRuns: DynamicRun[] }> {
	return requestJson<{ dynamicRuns: DynamicRun[] }>(
		`/api/findings/${findingId}/dynamic-runs`,
	);
}

export async function triggerFindingDynamicRun(
	findingId: string,
	params: {
		profileId: string;
		runner?: "docker";
		dockerImage?: string;
		network?: "none" | "default";
		timeoutSec?: number;
		memory?: string;
		cpus?: string;
	},
): Promise<any> {
	return requestJson<any>(`/api/findings/${findingId}/dynamic-runs`, {
		method: "POST",
		body: params,
	});
}

export async function fetchDynamicRun(
	dynamicRunId: string,
): Promise<{ dynamicRun: DynamicRun }> {
	return requestJson<{ dynamicRun: DynamicRun }>(
		`/api/dynamic-runs/${dynamicRunId}`,
	);
}

export async function fetchDynamicRunArtifacts(dynamicRunId: string): Promise<{
	artifacts: DynamicArtifact[];
	evidence: DynamicEvidence[];
}> {
	return requestJson<{
		artifacts: DynamicArtifact[];
		evidence: DynamicEvidence[];
	}>(`/api/dynamic-runs/${dynamicRunId}/artifacts`);
}
