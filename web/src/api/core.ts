import type {
	AdminUser,
	AgenticSearchResult,
	AuthUser,
	ChatCompletionResult,
	CodexStatusResponse,
	ConversationItem,
	ConversationMessage,
	LlmProviderHealthResult,
	LlmSettingsResponse,
	RetrievalLog,
	RetrievedFragment,
	SourceCategoryResponse,
	SourceHealth,
	SourceHistoryItem,
	SourceMutationResponse,
	SourcePage,
	SourceReindexResponse,
	SourceTreeResponse,
	SystemContextResponse,
	WebSearchResult,
} from "./core-types";

export type * from "./core-types";

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

export async function requestJson<T>(
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

export async function requestVoid(
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
	messages: Array<{ role: "user" | "assistant"; content: string }>;
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
