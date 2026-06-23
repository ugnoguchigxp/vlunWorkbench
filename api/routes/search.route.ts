import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import {
	evaluateRetrieverCompat,
	type SourceRetriever,
} from "../modules/rag/retriever";
import type { WebSearchProvider, WebSearchResult } from "../providers/types";

const SearchRequestSchema = z.object({
	query: z.string().min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z
		.string()
		.trim()
		.min(1)
		.regex(/^[^/]+$/, "Invalid category")
		.optional(),
});

type SearchRouteDeps = {
	retriever: SourceRetriever;
	webSearchProvider?: WebSearchProvider;
	webSearchProviderName?: string | null;
	webSearchUnavailableMessage?: string | null;
};

export function createSearchRoute(deps: SearchRouteDeps) {
	return new Hono().post(
		"/",
		zValidator("json", SearchRequestSchema),
		async (c) => {
			const body = c.req.valid("json");
			const topK = body.topK ?? 8;
			let webSearchMessage: string | undefined;
			const webResultsPromise: Promise<WebSearchResult[]> =
				deps.webSearchProvider
					? deps.webSearchProvider
							.search({
								query: body.query,
								maxResults: topK,
								lang: "ja",
							})
							.catch((error) => {
								webSearchMessage =
									error instanceof Error ? error.message : "Web search failed.";
								return [];
							})
					: Promise.resolve([]);
			const [evaluation, webResults] = await Promise.all([
				evaluateRetrieverCompat(deps.retriever, body.query, {
					topK,
					enableTrigramFallback: true,
					category: body.category,
				}),
				webResultsPromise,
			]);
			return c.json({
				query: body.query,
				topK,
				category: body.category ?? null,
				strategy: evaluation.strategy,
				vectorResults: evaluation.vectorResults,
				textResults: evaluation.textResults,
				webResults,
				webSearch: {
					available: Boolean(deps.webSearchProvider),
					provider:
						deps.webSearchProviderName ?? deps.webSearchProvider?.name ?? null,
					message: webSearchMessage ?? null,
					unavailableMessage: deps.webSearchProvider
						? null
						: (deps.webSearchUnavailableMessage ?? null),
				},
				mergedResults: evaluation.mergedResults,
				selectedResults: evaluation.selectedResults,
			});
		},
	);
}
