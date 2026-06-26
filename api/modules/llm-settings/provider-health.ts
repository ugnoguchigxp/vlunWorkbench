import type { LlmProviderEndpointSettings } from "./llm-settings.schema";

export type LlmProviderHealthResult = {
	ok: boolean;
	reachable: boolean;
	status: string;
	url: string | null;
	message: string;
	durationMs: number;
	checkedAt: string;
};

type HealthOptions = {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	apiKey?: string;
};

function normalizeBaseUrl(
	endpoint: LlmProviderEndpointSettings,
): string | null {
	if (endpoint.kind === "azure") return endpoint.endpoint ?? null;
	if (
		endpoint.kind === "openai" ||
		endpoint.kind === "openai-compatible" ||
		endpoint.kind === "local"
	) {
		return (endpoint.baseUrl ?? "https://api.openai.com/v1").replace(
			/\/+$/,
			"",
		);
	}
	return null;
}

function buildHealthUrl(endpoint: LlmProviderEndpointSettings): string | null {
	const baseUrl = normalizeBaseUrl(endpoint);
	if (!baseUrl) return null;
	if (endpoint.kind === "local") {
		const url = new URL(baseUrl);
		return `${url.origin}/health`;
	}
	if (endpoint.kind === "azure") {
		return baseUrl.replace(/\/+$/, "");
	}
	const base = new URL(`${baseUrl}/`);
	return new URL("models", base).toString();
}

export async function checkLlmProviderHealth(
	endpoint: LlmProviderEndpointSettings,
	options: HealthOptions = {},
): Promise<LlmProviderHealthResult> {
	const started = Date.now();
	const checkedAt = new Date().toISOString();
	const url = buildHealthUrl(endpoint);
	if (endpoint.kind === "codex") {
		return {
			ok: true,
			reachable: true,
			status: "codex_status_required",
			url: null,
			message: "Use the Codex status API for Codex endpoints.",
			durationMs: Date.now() - started,
			checkedAt,
		};
	}
	if (!url) {
		return {
			ok: false,
			reachable: false,
			status: "missing_url",
			url: null,
			message: "Provider endpoint URL is not configured.",
			durationMs: Date.now() - started,
			checkedAt,
		};
	}

	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? 3_000,
	);
	const headers: Record<string, string> = {};
	if (endpoint.kind === "azure" && options.apiKey) {
		headers["api-key"] = options.apiKey;
	} else if (options.apiKey) {
		headers.Authorization = `Bearer ${options.apiKey}`;
	}

	try {
		const response = await fetchImpl(url, {
			method: "GET",
			headers,
			signal: controller.signal,
		});
		clearTimeout(timeout);
		return {
			ok: response.ok,
			reachable: true,
			status: String(response.status),
			url,
			message: response.ok ? "Provider is reachable." : response.statusText,
			durationMs: Date.now() - started,
			checkedAt,
		};
	} catch (error) {
		clearTimeout(timeout);
		return {
			ok: false,
			reachable: false,
			status: "request_failed",
			url,
			message: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - started,
			checkedAt,
		};
	}
}
