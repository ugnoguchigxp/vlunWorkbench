import { z } from "zod";
import { clampText } from "../utils";
import type { AgenticToolDefinition } from "./types";

const SearchEvidenceArgsSchema = z.object({
	query: z.string().trim().min(1),
	topK: z.number().int().min(1).max(20).optional(),
});

export const searchEvidenceTool: AgenticToolDefinition = {
	name: "search_evidence",
	description:
		"Run full-text search, vector search, and web search together with the same query. Use this only after deciding search is required.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			query: { type: "string", minLength: 1 },
			topK: { type: "integer", minimum: 1, maximum: 20 },
		},
		required: ["query"],
	},
	async execute(rawArgs, deps, runtime) {
		const args = SearchEvidenceArgsSchema.parse(rawArgs);
		const topK = args.topK ?? runtime.topK;
		if (!deps.evidenceCollector) {
			return {
				output: {
					query: args.query,
					topK,
					degraded: true,
					message: "Search evidence collector is not configured.",
				},
				resultCount: 0,
			};
		}

		const evidence = await deps.evidenceCollector.collect({
			query: args.query,
			topK,
			category: runtime.category,
		});
		const localPayload = {
			strategy: evidence.evaluation.strategy,
			selected: evidence.retrieved.map((item) => ({
				id: item.id,
				sourceId: item.sourceId,
				sourceUri: item.sourceUri,
				sourceCategory: item.sourceCategory,
				locator: item.locator,
				heading: item.heading,
				content: clampText(item.content, 700),
				wikiSlug: item.wikiSlug ?? null,
				combinedScore: item.combinedScore,
				vectorScore: item.vectorScore,
				textScore: item.textScore,
			})),
			fullTextResults: evidence.evaluation.textResults.map((item) => ({
				id: item.id,
				sourceUri: item.sourceUri,
				locator: item.locator,
				heading: item.heading,
				content: clampText(item.content, 500),
				wikiSlug: item.wikiSlug ?? null,
				textScore: item.textScore,
				sourceHitCount: item.sourceHitCount,
			})),
			vectorResults: evidence.evaluation.vectorResults.map((item) => ({
				id: item.id,
				sourceUri: item.sourceUri,
				locator: item.locator,
				heading: item.heading,
				content: clampText(item.content, 500),
				wikiSlug: item.wikiSlug ?? null,
				vectorScore: item.vectorScore,
				sourceHitCount: item.sourceHitCount,
			})),
		};
		const webPayload = evidence.webResults.map((item) => ({
			title: item.title,
			url: item.url,
			snippet: item.snippet,
			position: item.position,
			content: item.content ? clampText(item.content, 700) : undefined,
		}));

		return {
			output: {
				query: evidence.query,
				topK,
				category: evidence.category ?? null,
				local: localPayload,
				web: {
					results: webPayload,
				},
			},
			resultCount: evidence.retrieved.length + evidence.webResults.length,
			retrieved: evidence.retrieved,
			webResults: evidence.webResults,
			citations: [
				...evidence.retrieved.map((item) => ({
					kind: "wiki_fragment" as const,
					title: item.heading ?? item.sourceUri,
					uri: item.sourceUri,
					locator: item.locator,
					wikiSlug: item.wikiSlug ?? null,
				})),
				...evidence.webResults.map((item) => ({
					kind: "web_search_result" as const,
					title: item.title || item.url,
					url: item.url,
				})),
			],
		};
	},
};
