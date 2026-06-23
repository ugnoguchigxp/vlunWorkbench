import { afterEach, describe, expect, it, vi } from "vitest";
import { ExaSearchProvider } from "./ExaSearchProvider";

const originalFetch = globalThis.fetch;

describe("ExaSearchProvider", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("posts to Exa search API and maps highlights to snippets", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{
							title: "Biome documentation",
							url: "https://biomejs.dev/guides/getting-started/",
							highlights: ["  Biome formats and lints projects.  "],
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const provider = new ExaSearchProvider("exa-key", {
			baseUrl: "https://api.exa.test/",
			timeout: 1234,
		});
		const results = await provider.search({
			query: "Biome best practices",
			maxResults: 2,
			lang: "ja",
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, request] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.exa.test/search");
		expect(request).toMatchObject({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": "exa-key",
			},
		});
		expect(JSON.parse(request.body as string)).toEqual({
			query: "Biome best practices",
			numResults: 2,
			type: "auto",
			userLocation: "JP",
			contents: {
				highlights: true,
			},
		});
		expect(results).toEqual([
			{
				title: "Biome documentation",
				url: "https://biomejs.dev/guides/getting-started/",
				snippet: "Biome formats and lints projects.",
				position: 1,
			},
		]);
	});
});
