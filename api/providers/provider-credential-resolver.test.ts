import { describe, expect, it } from "vitest";
import { readAppEnv } from "../app/env";
import type { LlmProviderEndpointSettings } from "../modules/llm-settings/llm-settings.schema";
import { resolveProviderCredential } from "./provider-credential-resolver";

const endpoint = (
	overrides: Partial<LlmProviderEndpointSettings>,
): LlmProviderEndpointSettings => ({
	id: "provider",
	name: "Provider",
	kind: "openai",
	enabled: true,
	apiKey: "",
	baseUrl: "https://api.openai.com/v1",
	endpoint: "",
	apiVersion: "",
	region: "",
	models: ["model"],
	modelDisplayNames: {},
	modelCapabilities: {},
	...overrides,
});

describe("provider credential resolver", () => {
	it("prefers a stored credential", () => {
		const env = readAppEnv({ OPENAI_API_KEY: "environment-secret" });
		expect(
			resolveProviderCredential(endpoint({ apiKey: "stored-secret" }), env),
		).toEqual({ apiKey: "stored-secret", source: "stored" });
	});

	it("binds OpenAI environment credentials to the canonical environment URL", () => {
		const env = readAppEnv({
			OPENAI_API_KEY: "environment-secret",
			OPENAI_BASE_URL: "https://api.openai.com/v1/",
		});
		expect(resolveProviderCredential(endpoint({}), env)).toEqual({
			apiKey: "environment-secret",
			source: "environment",
		});
		expect(
			resolveProviderCredential(
				endpoint({
					kind: "openai-compatible",
					baseUrl: "https://attacker.example/v1",
				}),
				env,
			),
		).toEqual({ source: "none" });
	});

	it("binds Azure environment credentials to the configured endpoint", () => {
		const env = readAppEnv({
			AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
			AZURE_OPENAI_API_KEY: "azure-secret",
		});
		expect(
			resolveProviderCredential(
				endpoint({
					kind: "azure",
					baseUrl: "",
					endpoint: "https://example.openai.azure.com/",
				}),
				env,
			),
		).toEqual({ apiKey: "azure-secret", source: "environment" });
		expect(
			resolveProviderCredential(
				endpoint({
					kind: "azure",
					baseUrl: "",
					endpoint: "https://attacker.openai.azure.com",
				}),
				env,
			),
		).toEqual({ source: "none" });
	});
});
