import { describe, expect, it } from "vitest";
import type { AppEnv } from "../app/env";
import { createAzureOpenAiProviderFromAppEnv } from "./azureOpenAiProviderFactory";

const env = {
	azureOpenAiDeployment: "gpt-4o-mini",
	azureOpenAiEmbeddingsDeployment: "text-embedding-3-small",
	azureOpenAiApiVersion: "2024-06-01",
} as AppEnv;

describe("createAzureOpenAiProviderFromAppEnv", () => {
	it("requires endpoint and API key", () => {
		expect(() =>
			createAzureOpenAiProviderFromAppEnv({
				...env,
				azureOpenAiEndpoint: undefined,
				azureOpenAiApiKey: "key",
			}),
		).toThrow("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required");
		expect(() =>
			createAzureOpenAiProviderFromAppEnv({
				...env,
				azureOpenAiEndpoint: "https://example.openai.azure.com",
				azureOpenAiApiKey: undefined,
			}),
		).toThrow("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are required");
	});

	it("constructs a provider from app env", () => {
		const provider = createAzureOpenAiProviderFromAppEnv({
			...env,
			azureOpenAiEndpoint: "https://example.openai.azure.com/",
			azureOpenAiApiKey: "key",
		});
		expect(provider).toBeDefined();
	});
});
