import type { AppEnv } from "../app/env";
import type {
	LlmProviderEndpointSettings,
	LlmThinkingDepth,
} from "../modules/llm-settings/llm-settings.schema";
import { AzureOpenAiProvider } from "./AzureOpenAiProvider";
import { CodexSdkProvider } from "./codexSdkProvider";
import { OpenAiCompatibleProvider } from "./openAiCompatibleProvider";
import type { LlmRouteFailureKind } from "./llmTaskTypes";
import type { LlmProvider } from "./types";
import { resolveProviderCredential } from "./provider-credential-resolver";

export type CreateLlmProviderInput = {
	endpoint: LlmProviderEndpointSettings;
	model: string;
	thinkingDepth?: LlmThinkingDepth;
	env?: AppEnv;
};

export class LlmProviderFactoryError extends Error {
	constructor(
		readonly failureKind: Extract<
			LlmRouteFailureKind,
			| "llm_provider_missing"
			| "llm_provider_credentials_missing"
			| "llm_provider_adapter_unavailable"
		>,
		message: string,
	) {
		super(message);
		this.name = "LlmProviderFactoryError";
	}
}

function allowedHostsForEndpoint(
	endpoint: LlmProviderEndpointSettings,
	env?: AppEnv,
): string[] {
	const hosts = [...(env?.llmProviderAllowedHosts ?? [])];
	if (endpoint.kind === "azure" && env?.azureOpenAiEndpoint) {
		hosts.push(new URL(env.azureOpenAiEndpoint).hostname);
	}
	return [...new Set(hosts.map((host) => host.toLowerCase()))];
}

export function createLlmProviderForEndpoint(
	input: CreateLlmProviderInput,
): LlmProvider {
	const { endpoint, model, thinkingDepth, env } = input;
	const apiKey = resolveProviderCredential(endpoint, env).apiKey;
	const nodeEnv = env?.nodeEnv ?? "production";

	if (endpoint.kind === "azure") {
		if (!endpoint.endpoint) {
			throw new LlmProviderFactoryError(
				"llm_provider_missing",
				`Azure endpoint ${endpoint.id} is missing endpoint.`,
			);
		}
		if (!apiKey) {
			throw new LlmProviderFactoryError(
				"llm_provider_credentials_missing",
				`Azure endpoint ${endpoint.id} is missing an API key.`,
			);
		}
		return new AzureOpenAiProvider({
			endpoint: endpoint.endpoint,
			apiKey,
			deployment: model,
			apiVersion: endpoint.apiVersion ?? env?.azureOpenAiApiVersion,
			outboundPolicy: {
				kind: "azure",
				nodeEnv,
				allowedHosts: allowedHostsForEndpoint(endpoint, env),
			},
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
			throw new LlmProviderFactoryError(
				"llm_provider_missing",
				`Endpoint ${endpoint.id} is missing baseUrl.`,
			);
		}
		if (endpoint.kind === "openai" && !apiKey) {
			throw new LlmProviderFactoryError(
				"llm_provider_credentials_missing",
				`OpenAI endpoint ${endpoint.id} is missing an API key.`,
			);
		}
		return new OpenAiCompatibleProvider({
			baseUrl: endpoint.baseUrl,
			apiKey,
			model,
			apiVersion: endpoint.apiVersion,
			outboundPolicy: {
				kind: endpoint.kind,
				nodeEnv,
				allowedHosts: allowedHostsForEndpoint(endpoint, env),
			},
		});
	}

	if (endpoint.kind === "codex") {
		return new CodexSdkProvider({
			model,
			apiKey,
			timeoutMs: env?.codexSdkTimeoutMs,
			reasoningEffort:
				thinkingDepth === "very_high"
					? "xhigh"
					: thinkingDepth === ""
						? undefined
						: thinkingDepth,
		});
	}

	throw new LlmProviderFactoryError(
		"llm_provider_adapter_unavailable",
		`Provider kind ${endpoint.kind} is configured but no execution adapter is available.`,
	);
}
