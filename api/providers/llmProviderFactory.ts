import type { AppEnv } from "../app/env";
import type { LlmProviderEndpointSettings } from "../modules/llm-settings/llm-settings.schema";
import { AzureOpenAiProvider } from "./AzureOpenAiProvider";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type { LlmProvider } from "./types";

export type CreateLlmProviderInput = {
	endpoint: LlmProviderEndpointSettings;
	model: string;
	env?: AppEnv;
};

function secretForEndpoint(
	endpoint: LlmProviderEndpointSettings,
	env?: AppEnv,
): string | undefined {
	if (endpoint.apiKey) return endpoint.apiKey;
	if (endpoint.kind === "azure") return env?.azureOpenAiApiKey;
	if (endpoint.kind === "openai") return env?.openAiApiKey;
	return undefined;
}

export function createLlmProviderForEndpoint(
	input: CreateLlmProviderInput,
): LlmProvider {
	const { endpoint, model, env } = input;
	const apiKey = secretForEndpoint(endpoint, env);

	if (endpoint.kind === "azure") {
		if (!endpoint.endpoint) {
			throw new Error(`Azure endpoint ${endpoint.id} is missing endpoint.`);
		}
		if (!apiKey) {
			throw new Error(`Azure endpoint ${endpoint.id} is missing an API key.`);
		}
		return new AzureOpenAiProvider({
			endpoint: endpoint.endpoint,
			apiKey,
			deployment: model,
			apiVersion: endpoint.apiVersion ?? env?.azureOpenAiApiVersion,
		});
	}

	if (
		endpoint.kind === "openai" ||
		endpoint.kind === "openai-compatible" ||
		endpoint.kind === "local"
	) {
		if (
			(endpoint.kind === "openai-compatible" || endpoint.kind === "local") &&
			!endpoint.baseUrl
		) {
			throw new Error(`Endpoint ${endpoint.id} is missing baseUrl.`);
		}
		return new OpenAiCompatibleProvider({
			baseUrl: endpoint.baseUrl,
			apiKey,
			model,
			apiVersion: endpoint.apiVersion,
		});
	}

	throw new Error(
		`Provider kind ${endpoint.kind} is configured but no execution adapter is available.`,
	);
}
