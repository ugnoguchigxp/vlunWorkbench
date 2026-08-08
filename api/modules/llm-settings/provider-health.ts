import type { LlmProviderEndpointSettings } from "./llm-settings.schema";
import { readCodexStatus } from "./codex-status";
import {
	fetchWithOutboundPolicy,
	type OutboundUrlPolicy,
} from "../../security/outbound-url-policy";

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
	outboundPolicy?: OutboundUrlPolicy;
	codexStatusReader?: typeof readCodexStatus;
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
		const status = await (options.codexStatusReader ?? readCodexStatus)({
			settingsModels: endpoint.models,
			codexApiKey: options.apiKey ?? endpoint.apiKey,
		});
		const ok = status.authenticated && status.executableAdapterAvailable;
		const healthStatus = !status.adapterDiagnostics.sdkImportable
			? "codex_sdk_unavailable"
			: !status.adapterDiagnostics.cliBinaryResolved
				? "codex_binary_unavailable"
				: !status.authenticated
					? "codex_auth_missing"
					: "codex_local_ready";
		return {
			ok,
			reachable: false,
			status: healthStatus,
			url: null,
			message:
				healthStatus === "codex_sdk_unavailable" ||
				healthStatus === "codex_binary_unavailable"
					? status.adapterDiagnostics.message
					: healthStatus === "codex_auth_missing"
						? "Codex authentication is not configured."
						: "Codex authentication is configured and the local SDK prerequisites are available. Process launch and live connectivity are not verified.",
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

	const fetchImpl = options.fetchImpl;
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
		const requestInit = {
			method: "GET",
			headers,
			signal: controller.signal,
		};
		const response = options.outboundPolicy
			? await fetchWithOutboundPolicy({
					url,
					init: requestInit,
					policy: options.outboundPolicy,
					fetchImpl,
				})
			: await (fetchImpl ?? fetch)(url, requestInit);
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
			message:
				error instanceof Error
					? error.message.slice(0, 240)
					: "Provider request failed.",
			durationMs: Date.now() - started,
			checkedAt,
		};
	}
}
