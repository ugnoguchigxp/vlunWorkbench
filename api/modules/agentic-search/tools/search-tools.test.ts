import { describe, expect, it } from "vitest";
import type { CollectSearchEvidenceInput } from "../../rag/search-evidence";
import type { SourceRepository } from "../../sources/source.repository";
import { fullTextSearchTool } from "./full-text-search.tool";
import { searchEvidenceTool } from "./search-evidence.tool";
import type { AgenticToolDeps, AgenticToolRuntimeContext } from "./types";
import { vectorSearchTool } from "./vector-search.tool";

const runtime: AgenticToolRuntimeContext = {
	query: "biome",
	topK: 8,
	fetchCount: 0,
	maxFetchCalls: 2,
	maxContextChars: 4000,
};

const searchRow = {
	id: "fragment-1",
	sourceId: "source-1",
	sourceUri: "tech/biome.md",
	sourceTitle: "Biome ベストプラクティス",
	sourceCategory: "tech",
	sourceMetadata: { relativePath: "pages/tech/biome.md" },
	locator: "chunk-1",
	heading: "recommended: true から始める",
	content: "Biome の recommended rule から始める。",
	score: 0.5,
};

describe("agentic local search tools", () => {
	it("uses the source markdown title for full-text search citations", async () => {
		const deps: AgenticToolDeps = {
			sourceRepository: {
				searchSourceContent: async () => [searchRow],
			} as unknown as SourceRepository,
			createEmbedding: async () => [],
			readWikiPage: async () => null,
			maxContextChars: 4000,
		};

		const result = await fullTextSearchTool.execute(
			{ query: "biome" },
			deps,
			runtime,
		);

		expect(result.citations?.[0]?.title).toBe("Biome ベストプラクティス");
	});

	it("uses the source markdown title for vector search citations", async () => {
		const deps: AgenticToolDeps = {
			sourceRepository: {
				vectorSearchSourceContent: async () => [searchRow],
			} as unknown as SourceRepository,
			createEmbedding: async () => [0.1, 0.2],
			readWikiPage: async () => null,
			maxContextChars: 4000,
		};

		const result = await vectorSearchTool.execute(
			{ query: "biome" },
			deps,
			runtime,
		);

		expect(result.citations?.[0]?.title).toBe("Biome ベストプラクティス");
	});

	it("runs combined evidence search through the shared collector", async () => {
		const deps: AgenticToolDeps = {
			sourceRepository: {} as SourceRepository,
			createEmbedding: async () => [],
			readWikiPage: async () => null,
			evidenceCollector: {
				collect: async (input: CollectSearchEvidenceInput) => ({
					query: input.query,
					category: input.category,
					topK: input.topK,
					evaluation: {
						strategy: "merged" as const,
						vectorResults: [],
						textResults: [],
						mergedResults: [],
						selectedResults: [],
					},
					retrieved: [
						{
							id: "fragment-1",
							sourceId: "source-1",
							sourceUri: "tech/biome.md",
							sourceCategory: "tech",
							locator: "chunk-1",
							heading: "Biome",
							content: "Biome content",
							combinedScore: 0.9,
							wikiSlug: "tech/biome",
						},
					],
					citations: [],
					webResults: [
						{
							title: "Biome",
							url: "https://biomejs.dev",
							snippet: "Biome snippet",
							position: 1,
						},
					],
					localContext: "local",
					webContext: "web",
				}),
			} as never,
			maxContextChars: 4000,
		};

		const result = await searchEvidenceTool.execute(
			{ query: "biome", topK: 3 },
			deps,
			runtime,
		);

		expect(result.resultCount).toBe(2);
		expect(result.retrieved).toHaveLength(1);
		expect(result.webResults).toHaveLength(1);
		expect(result.citations?.map((item) => item.kind)).toEqual([
			"wiki_fragment",
			"web_search_result",
		]);
	});
});
