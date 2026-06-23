import { z } from "zod";
import type { AgenticToolDefinition } from "./types";

const WebSearchArgsSchema = z.object({
	query: z.string().trim().min(1),
	maxResults: z.number().int().min(1).max(10).optional(),
});

export const webSearchTool: AgenticToolDefinition = {
	name: "web_search",
	description:
		"Search the web for external sources using the configured web search provider. Use this when local wiki evidence is insufficient or the question needs current public information.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			query: { type: "string", minLength: 1 },
			maxResults: { type: "integer", minimum: 1, maximum: 10 },
		},
		required: ["query"],
	},
	async execute(rawArgs, deps, _runtime) {
		const args = WebSearchArgsSchema.parse(rawArgs);
		const maxResults = args.maxResults ?? 5;
		if (!deps.webSearchProvider) {
			return {
				output: {
					query: args.query,
					results: [],
					degraded: true,
					message:
						deps.webSearchUnavailableMessage ??
						"Web search provider is not configured. Set EXA_API_KEY.",
				},
				resultCount: 0,
			};
		}
		const results = await deps.webSearchProvider.search({
			query: args.query,
			maxResults,
		});
		const payload = results.map((item) => ({
			title: item.title,
			url: item.url,
			snippet: item.snippet,
			position: item.position,
		}));
		return {
			output: {
				query: args.query,
				maxResults,
				provider: deps.webSearchProvider.name ?? "web",
				results: payload,
			},
			resultCount: payload.length,
			citations: payload.map((item) => ({
				kind: "web_search_result" as const,
				title: item.title || item.url,
				url: item.url,
			})),
		};
	},
};
