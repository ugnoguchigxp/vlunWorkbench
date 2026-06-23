import { describe, expect, it, vi } from "vitest";
import { createSearchRoute } from "./search.route";

describe("createSearchRoute", () => {
	it("returns local retrieval and Web Search results together", async () => {
		const retriever = {
			evaluate: vi.fn().mockResolvedValue({
				strategy: "merged",
				vectorResults: [],
				textResults: [],
				mergedResults: [],
				selectedResults: [],
			}),
		};
		const webSearchProvider = {
			search: vi.fn().mockResolvedValue([
				{
					title: "Result A",
					url: "https://example.com/a",
					snippet: "Snippet A",
					position: 1,
				},
			]),
		};
		const app = createSearchRoute({
			retriever: retriever as never,
			webSearchProvider,
			webSearchProviderName: "exa",
		});

		const response = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "biome", topK: 3, category: "tech" }),
		});
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(retriever.evaluate).toHaveBeenCalledWith("biome", {
			topK: 3,
			enableTrigramFallback: true,
			category: "tech",
		});
		expect(webSearchProvider.search).toHaveBeenCalledWith({
			query: "biome",
			maxResults: 3,
			lang: "ja",
		});
		expect(body.webResults).toEqual([
			{
				title: "Result A",
				url: "https://example.com/a",
				snippet: "Snippet A",
				position: 1,
			},
		]);
		expect(body.webSearch).toEqual({
			available: true,
			provider: "exa",
			message: null,
			unavailableMessage: null,
		});
	});

	it("keeps search available when Web Search is not configured", async () => {
		const app = createSearchRoute({
			retriever: {
				evaluate: vi.fn().mockResolvedValue({
					strategy: "merged",
					vectorResults: [],
					textResults: [],
					mergedResults: [],
					selectedResults: [],
				}),
			} as never,
			webSearchProviderName: "exa",
			webSearchUnavailableMessage: "Exa Search is not configured. Set EXA_API_KEY.",
		});

		const response = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ query: "biome" }),
		});
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.webResults).toEqual([]);
		expect(body.webSearch).toEqual({
			available: false,
			provider: "exa",
			message: null,
			unavailableMessage: "Exa Search is not configured. Set EXA_API_KEY.",
		});
	});
});
