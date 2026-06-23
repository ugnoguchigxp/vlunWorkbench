import { describe, expect, it } from "vitest";
import { createConfiguredWebSearchProvider } from "./webSearchProviderFactory";

describe("createConfiguredWebSearchProvider", () => {
	it("prefers Exa when configured explicitly", () => {
		const configured = createConfiguredWebSearchProvider({
			webSearchProviderMode: "exa",
			exaApiKey: "exa-key",
			exaSearchBaseUrl: "https://api.exa.ai",
			braveSearchApiKey: "brave-key",
		});

		expect(configured.providerName).toBe("exa");
		expect(configured.provider?.name).toBe("exa");
		expect(configured.unavailableMessage).toBeNull();
	});

	it("does not fall back to Brave when Exa mode is selected without EXA_API_KEY", () => {
		const configured = createConfiguredWebSearchProvider({
			webSearchProviderMode: "exa",
			exaSearchBaseUrl: "https://api.exa.ai",
			braveSearchApiKey: "brave-key",
		});

		expect(configured.provider).toBeUndefined();
		expect(configured.providerName).toBe("exa");
		expect(configured.unavailableMessage).toBe(
			"Exa Search is not configured. Set EXA_API_KEY.",
		);
	});

	it("can use Brave as an explicit fallback provider", () => {
		const configured = createConfiguredWebSearchProvider({
			webSearchProviderMode: "brave",
			exaSearchBaseUrl: "https://api.exa.ai",
			braveSearchApiKey: "brave-key",
		});

		expect(configured.providerName).toBe("brave");
		expect(configured.provider?.name).toBe("brave");
		expect(configured.unavailableMessage).toBeNull();
	});
});
