import type { AppEnv } from "../app/env";
import type { LlmProviderEndpointSettings } from "../modules/llm-settings/llm-settings.schema";

const canonicalUrl = (value: string): string => {
	const url = new URL(value);
	url.hash = "";
	url.username = "";
	url.password = "";
	url.hostname = url.hostname.toLowerCase();
	url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	return url.toString().replace(/\/$/, "");
};

export type ResolvedProviderCredential = {
	apiKey?: string;
	source: "stored" | "environment" | "none";
};

export function resolveProviderCredential(
	endpoint: LlmProviderEndpointSettings,
	env?: AppEnv,
): ResolvedProviderCredential {
	const stored = endpoint.apiKey?.trim();
	if (stored) return { apiKey: stored, source: "stored" };
	if (!env) return { source: "none" };

	if (
		endpoint.kind === "openai" &&
		env.openAiCredentialSource === "openai" &&
		env.openAiApiKey
	) {
		const endpointUrl = endpoint.baseUrl || "https://api.openai.com/v1";
		const environmentUrl = env.openAiBaseUrl || "https://api.openai.com/v1";
		if (canonicalUrl(endpointUrl) === canonicalUrl(environmentUrl)) {
			return { apiKey: env.openAiApiKey, source: "environment" };
		}
	}

	if (
		endpoint.kind === "azure" &&
		env.azureOpenAiApiKey &&
		env.azureOpenAiEndpoint &&
		endpoint.endpoint &&
		canonicalUrl(endpoint.endpoint) === canonicalUrl(env.azureOpenAiEndpoint)
	) {
		return { apiKey: env.azureOpenAiApiKey, source: "environment" };
	}

	return { source: "none" };
}
