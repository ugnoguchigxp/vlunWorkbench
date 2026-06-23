import { describe, expect, it, vi } from "vitest";
import { SearchEvidenceCollector } from "./search-evidence";

const fragment = {
	id: "fragment-1",
	sourceId: "source-1",
	sourceUri: "tech/biome.md",
	sourceCategory: "tech",
	locator: "chunk:0001",
	heading: "Biome",
	content: "Biome content",
	combinedScore: 0.9,
	wikiSlug: "tech/biome",
};

describe("SearchEvidenceCollector", () => {
	it("uses the same query for full-text/vector retrieval and web search", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new Error("skip page fetch")) as unknown as typeof fetch;
		const retriever = {
			evaluate: vi.fn().mockResolvedValue({
				strategy: "merged",
				vectorResults: [fragment],
				textResults: [fragment],
				mergedResults: [fragment],
				selectedResults: [fragment],
			}),
		};
		const webSearchProvider = {
			name: "exa",
			search: vi.fn().mockResolvedValue([
				{
					title: "Biome",
					url: "https://biomejs.dev",
					snippet: "Biome snippet",
					position: 1,
				},
			]),
		};
		const collector = new SearchEvidenceCollector({
			retriever: retriever as never,
			webSearchProvider,
		});

		try {
			const evidence = await collector.collect({
				query: "Biome best practices",
				topK: 5,
				category: "tech",
			});

			expect(retriever.evaluate).toHaveBeenCalledWith("Biome best practices", {
				topK: 5,
				enableTrigramFallback: true,
				category: "tech",
			});
			expect(webSearchProvider.search).toHaveBeenCalledWith({
				query: "Biome best practices",
				maxResults: 5,
				lang: "ja",
			});
			expect(evidence.retrieved).toHaveLength(1);
			expect(evidence.webResults).toHaveLength(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
