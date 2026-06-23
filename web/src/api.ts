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

export const UNAUTHORIZED_EVENT_NAME = "hono-standard-rag:unauthorized";

let lastUnauthorizedEventAt = 0;

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
		const refreshResponse = await fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "include",
		});
		if (refreshResponse.ok) {
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
		const refreshResponse = await fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "include",
		});
		if (refreshResponse.ok) {
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

export async function fetchScans(projectId: string): Promise<ScanRun[]> {
	const params = new URLSearchParams({ projectId });
	const data = await requestJson<{ scans: ScanRun[] }>(
		`/api/scans?${params.toString()}`,
	);
	return data.scans;
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

export async function fetchFinding(
	findingId: string,
): Promise<{ finding: Finding; evidence: FindingEvidence[] }> {
	return requestJson<{ finding: Finding; evidence: FindingEvidence[] }>(
		`/api/findings/${findingId}`,
	);
}
