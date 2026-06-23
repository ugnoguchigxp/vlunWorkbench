import { z } from "zod";
import { clampText } from "../utils";
import type { AgenticToolDefinition } from "./types";

const WikiReadArgsSchema = z
	.object({
		wikiSlug: z.string().trim().min(1).optional(),
		sourceId: z.string().trim().min(1).optional(),
		sourceUri: z.string().trim().min(1).optional(),
		maxChars: z.number().int().min(200).max(50000).optional(),
	})
	.refine(
		(value) =>
			Boolean(value.wikiSlug) ||
			Boolean(value.sourceId) ||
			Boolean(value.sourceUri),
		{
			message: "wikiSlug, sourceId, or sourceUri is required",
		},
	);

export const wikiReadTool: AgenticToolDefinition = {
	name: "wiki_read",
	description:
		"Read source wiki page body when fragment-level search is insufficient for answering.",
	parameters: {
		type: "object",
		additionalProperties: false,
		properties: {
			wikiSlug: { type: "string", minLength: 1 },
			sourceId: { type: "string", minLength: 1 },
			sourceUri: { type: "string", minLength: 1 },
			maxChars: { type: "integer", minimum: 200, maximum: 50000 },
		},
	},
	async execute(rawArgs, deps, runtime) {
		const args = WikiReadArgsSchema.parse(rawArgs);
		const maxChars = Math.min(
			args.maxChars ?? runtime.maxContextChars,
			runtime.maxContextChars,
		);

		if (args.wikiSlug) {
			const page = await deps.readWikiPage(args.wikiSlug);
			if (!page) {
				return {
					output: {
						found: false,
						wikiSlug: args.wikiSlug,
						message: "Wiki page not found.",
					},
					resultCount: 0,
				};
			}
			const text = clampText(page.body, maxChars);
			return {
				output: {
					found: true,
					title: page.title,
					wikiSlug: page.slug,
					sourceUri: page.path,
					bodyExcerpt: text,
					bodyLength: page.body.length,
					truncated: page.body.length > text.length,
				},
				resultCount: 1,
				citations: [
					{
						kind: "wiki_page",
						title: page.title,
						uri: page.path,
						wikiSlug: page.slug,
					},
				],
			};
		}

		const source = args.sourceId
			? await deps.sourceRepository.getSourceById(args.sourceId)
			: await deps.sourceRepository.getSourceByUri(args.sourceUri ?? "");

		if (!source) {
			return {
				output: {
					found: false,
					sourceId: args.sourceId ?? null,
					sourceUri: args.sourceUri ?? null,
					message: "Source not found.",
				},
				resultCount: 0,
			};
		}

		const text = clampText(source.body, maxChars);
		const metadata =
			source.metadata && typeof source.metadata === "object"
				? (source.metadata as Record<string, unknown>)
				: null;
		const wikiSlug =
			metadata && typeof metadata.wikiSlug === "string"
				? metadata.wikiSlug
				: null;
		return {
			output: {
				found: true,
				title: source.title ?? source.uri,
				wikiSlug,
				sourceUri: source.uri,
				bodyExcerpt: text,
				bodyLength: source.body.length,
				truncated: source.body.length > text.length,
			},
			resultCount: 1,
			citations: [
				{
					kind: "wiki_page",
					title: source.title ?? source.uri,
					uri: source.uri,
					wikiSlug,
				},
			],
		};
	},
};
