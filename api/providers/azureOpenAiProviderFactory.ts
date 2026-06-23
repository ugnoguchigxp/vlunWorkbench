import type { AppEnv } from "../app/env";
import { AzureOpenAiProvider } from "./AzureOpenAiProvider";

export function createAzureOpenAiProviderFromAppEnv(
	env: AppEnv,
): AzureOpenAiProvider {
	if (!env.azureOpenAiEndpoint || !env.azureOpenAiApiKey) {
		throw new Error(
			"AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required",
		);
	}

	return new AzureOpenAiProvider({
		endpoint: env.azureOpenAiEndpoint,
		apiKey: env.azureOpenAiApiKey,
		deployment: env.azureOpenAiDeployment,
		embeddingsDeployment: env.azureOpenAiEmbeddingsDeployment,
		apiVersion: env.azureOpenAiApiVersion,
	});
}
