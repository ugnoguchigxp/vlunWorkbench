import { describe, expect, it, vi } from "vitest";
import { buildLocalContext, SearchEvidenceCollector } from "./search-evidence";

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
	it("keeps local context within the limit without cutting a fragment", () => {
		const context = buildLocalContext(
			[
				fragment,
				{
					...fragment,
					id: "fragment-2",
					content: "second fragment content",
				},
			],
			100,
		);

		expect(context).toContain("Biome content");
		expect(context).not.toContain("second fragment content");
		expect(context.length).toBeLessThanOrEqual(100);
	});

	it("uses the same query for full-text/vector retrieval and web search", async () => {
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
			pageContentFetcher: vi
				.fn()
				.mockRejectedValue(new Error("skip page fetch")),
		});

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
	});
});
