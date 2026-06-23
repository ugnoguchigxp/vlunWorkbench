import { z } from "zod";
import { resolveWikiLinkRef } from "../../sources/wiki/link-ref";
import { clampText } from "../utils";
import type { AgenticToolDefinition } from "./types";
import { toWikiFragmentCitation } from "./types";

const FullTextSearchArgsSchema = z.object({
	query: z.string().trim().min(1),
	topK: z.number().int().min(1).max(20).optional(),
	category: z.string().trim().min(1).optional(),
});

export const fullTextSearchTool: AgenticToolDefinition = {
	name: "full_text_search",
	description:
		"Search local wiki fragments by full-text terms. Use this first for exact keyword matches.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			query: { type: "string", minLength: 1 },
			topK: { type: "integer", minimum: 1, maximum: 20 },
			category: { type: "string", minLength: 1 },
		},
		required: ["query"],
	},
	async execute(rawArgs, deps, runtime) {
		const args = FullTextSearchArgsSchema.parse(rawArgs);
		const topK = args.topK ?? runtime.topK;
		const category = args.category ?? runtime.category;
		const categories = category ? [category] : undefined;

		const rows = await deps.sourceRepository.searchSourceContent(
			args.query,
			topK,
			["wiki"],
			categories,
		);

		const payload = rows.map((row) => {
			const linkRef = resolveWikiLinkRef({
				sourceUri: row.sourceUri,
				sourceMetadata: row.sourceMetadata,
				sourceCategory: row.sourceCategory,
			});
			return {
				id: row.id,
				sourceId: row.sourceId,
				sourceUri: row.sourceUri,
				title: row.sourceTitle ?? row.sourceUri,
				sourceCategory: row.sourceCategory,
				locator: row.locator,
				heading: row.heading,
				textScore: row.score,
				content: clampText(row.content, 500),
				wikiSlug: linkRef?.wikiSlug ?? null,
			};
		});

		return {
			output: {
				query: args.query,
				topK,
				category: category ?? null,
				hits: payload,
			},
			resultCount: payload.length,
			citations: payload.map((item) =>
				toWikiFragmentCitation({
					title: item.title,
					sourceUri: item.sourceUri,
					locator: item.locator,
					wikiSlug: item.wikiSlug,
				}),
			),
		};
	},
};
