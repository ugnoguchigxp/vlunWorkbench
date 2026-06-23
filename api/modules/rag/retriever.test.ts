import { describe, expect, it, vi } from "vitest";
import { SourceRetriever } from "./retriever";

const sampleResult = (overrides: Partial<Record<string, unknown>> = {}) => ({
	id: "frag-1",
	sourceId: "src-1",
	sourceUri: "/tmp/wiki/pages/tech/rag.md",
	sourceCategory: "tech",
	sourceMetadata: { relativePath: "pages/tech/rag.md" },
	locator: "chunk:0001",
	heading: "RAG",
	content: "retrieval augmented generation",
	score: 0.9,
	...overrides,
});

describe("SourceRetriever", () => {
	it("returns text results even when vector retrieval fails", async () => {
		const sourceRepository = {
			vectorSearchSourceContent: vi.fn(),
			searchSourceContent: vi
				.fn()
				.mockResolvedValue([sampleResult({ id: "text-1", score: 0.7 })]),
		};
		const embeddingProvider = {
			createEmbedding: vi
				.fn()
				.mockRejectedValue(new Error("embedding provider unavailable")),
		};
		const retriever = new SourceRetriever(
			sourceRepository as never,
			embeddingProvider as never,
		);

		const breakdown = await retriever.retrieveBreakdown("hono", {
			topK: 5,
			category: "tech",
		});
		const evaluation = await retriever.evaluate("hono", {
			topK: 5,
			enableTrigramFallback: true,
			category: "tech",
		});

		expect(embeddingProvider.createEmbedding).toHaveBeenCalledTimes(2);
		expect(sourceRepository.vectorSearchSourceContent).not.toHaveBeenCalled();
		expect(sourceRepository.searchSourceContent).toHaveBeenCalledWith(
			"hono",
			25,
			["wiki"],
			["tech"],
		);
		expect(breakdown.vectorResults).toEqual([]);
		expect(breakdown.textResults).toHaveLength(1);
		expect(breakdown.mergedResults).toHaveLength(1);
		expect(evaluation.strategy).toBe("merged");
		expect(evaluation.selectedResults).toHaveLength(1);
	});

	it("short-circuits blank queries", async () => {
		const sourceRepository = {
			vectorSearchSourceContent: vi.fn(),
			searchSourceContent: vi.fn(),
		};
		const embeddingProvider = {
			createEmbedding: vi.fn(),
		};
		const retriever = new SourceRetriever(
			sourceRepository as never,
			embeddingProvider as never,
		);

		const result = await retriever.retrieveBreakdown("   ", {
			topK: 8,
		});

		expect(result).toEqual({
			vectorResults: [],
			textResults: [],
			mergedResults: [],
		});
		expect(embeddingProvider.createEmbedding).not.toHaveBeenCalled();
		expect(sourceRepository.vectorSearchSourceContent).not.toHaveBeenCalled();
		expect(sourceRepository.searchSourceContent).not.toHaveBeenCalled();
	});

	it("aggregates text and vector breakdown results by source", async () => {
		const sourceRepository = {
			searchSourceContent: vi.fn().mockResolvedValue([
				sampleResult({ id: "text-1", locator: "chunk:0001", score: 0.9 }),
				sampleResult({ id: "text-2", locator: "chunk:0002", score: 0.8 }),
				sampleResult({
					id: "text-3",
					sourceId: "src-2",
					sourceUri: "/tmp/wiki/pages/tech/biome.md",
					sourceMetadata: { relativePath: "pages/tech/biome.md" },
					locator: "chunk:0001",
					score: 0.7,
				}),
			]),
			vectorSearchSourceContent: vi.fn().mockResolvedValue([
				sampleResult({ id: "vector-1", locator: "chunk:0001", score: 0.91 }),
				sampleResult({ id: "vector-2", locator: "chunk:0003", score: 0.82 }),
				sampleResult({
					id: "vector-3",
					sourceId: "src-2",
					sourceUri: "/tmp/wiki/pages/tech/biome.md",
					sourceMetadata: { relativePath: "pages/tech/biome.md" },
					locator: "chunk:0001",
					score: 0.72,
				}),
			]),
		};
		const embeddingProvider = {
			createEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
		};
		const retriever = new SourceRetriever(
			sourceRepository as never,
			embeddingProvider as never,
		);

		const breakdown = await retriever.retrieveBreakdown("biome", {
			topK: 5,
			category: "tech",
		});

		expect(breakdown.textResults).toHaveLength(2);
		expect(breakdown.textResults.map((item) => item.id)).toEqual([
			"text-1",
			"text-3",
		]);
		expect(breakdown.textResults[0].sourceHitCount).toBe(2);
		expect(breakdown.textResults[1].sourceHitCount).toBe(1);
		expect(breakdown.vectorResults).toHaveLength(2);
		expect(breakdown.vectorResults.map((item) => item.id)).toEqual([
			"vector-1",
			"vector-3",
		]);
		expect(breakdown.vectorResults[0].sourceHitCount).toBe(2);
		expect(breakdown.vectorResults[1].sourceHitCount).toBe(1);
	});
});
