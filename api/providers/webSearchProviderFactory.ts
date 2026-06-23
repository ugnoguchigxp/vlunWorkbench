import { BraveSearchProvider } from "./BraveSearchProvider";
import { ExaSearchProvider } from "./ExaSearchProvider";
import type { WebSearchProvider } from "./types";

export type WebSearchProviderMode = "exa" | "brave" | "auto";
export type WebSearchProviderName = "exa" | "brave";

type WebSearchProviderConfig = {
	webSearchProviderMode: WebSearchProviderMode;
	exaApiKey?: string;
	exaSearchBaseUrl: string;
	braveSearchApiKey?: string;
};

export type ConfiguredWebSearchProvider = {
	provider?: WebSearchProvider;
	providerName: WebSearchProviderName | null;
	unavailableMessage: string | null;
};

function createExaProvider(
	config: WebSearchProviderConfig,
): ConfiguredWebSearchProvider {
	if (!config.exaApiKey) {
		return {
			providerName: "exa",
			unavailableMessage: "Exa Search is not configured. Set EXA_API_KEY.",
		};
	}
	return {
		provider: new ExaSearchProvider(config.exaApiKey, {
			baseUrl: config.exaSearchBaseUrl,
		}),
		providerName: "exa",
		unavailableMessage: null,
	};
}

function createBraveProvider(
	config: WebSearchProviderConfig,
): ConfiguredWebSearchProvider {
	if (!config.braveSearchApiKey) {
		return {
			providerName: "brave",
			unavailableMessage:
				"Brave Search is not configured. Set BRAVE_SEARCH_API_KEY.",
		};
	}
	return {
		provider: new BraveSearchProvider(config.braveSearchApiKey),
		providerName: "brave",
		unavailableMessage: null,
	};
}

export function createConfiguredWebSearchProvider(
	config: WebSearchProviderConfig,
): ConfiguredWebSearchProvider {
	if (config.webSearchProviderMode === "exa") {
		return createExaProvider(config);
	}

	if (config.webSearchProviderMode === "brave") {
		return createBraveProvider(config);
	}

	if (config.exaApiKey) {
		return createExaProvider(config);
	}

	if (config.braveSearchApiKey) {
		return createBraveProvider(config);
	}

	return {
		providerName: null,
		unavailableMessage:
			"Web search is not configured. Set EXA_API_KEY or BRAVE_SEARCH_API_KEY.",
	};
}
