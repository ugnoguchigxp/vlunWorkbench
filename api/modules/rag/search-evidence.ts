import type { WebSearchProvider, WebSearchResult } from "../../providers/types";
import { WebSearchService } from "../../services/WebSearchService";
import {
	evaluateRetrieverCompat,
	type RetrievalEvaluation,
	type SourceRetriever,
} from "./retriever";
import type { Citation, RetrievedFragment } from "./types";

export type EvidenceWebResult = WebSearchResult & {
	content?: string;
};

export type SearchEvidence = {
	query: string;
	category?: string;
	topK: number;
	evaluation: RetrievalEvaluation;
	retrieved: RetrievedFragment[];
	citations: Citation[];
	webResults: EvidenceWebResult[];
	localContext: string;
	webContext: string;
};

export type SearchEvidenceCollectorDeps = {
	retriever: SourceRetriever;
	webSearchProvider?: WebSearchProvider;
};

export type CollectSearchEvidenceInput = {
	query: string;
	topK: number;
	category?: string;
};

export function toCitations(retrieved: RetrievedFragment[]): Citation[] {
	return retrieved.map((item) => ({
		sourceId: item.sourceId,
		fragmentId: item.id,
		uri: item.sourceUri,
		category: item.sourceCategory,
		title: item.heading ?? item.sourceUri.split("/").at(-1) ?? "Untitled",
		heading: item.heading ?? undefined,
		locator: item.locator,
		score: item.combinedScore,
	}));
}

export const MAX_LOCAL_CONTEXT_CHARS = 50_000;

export function buildLocalContext(
	retrieved: RetrievedFragment[],
	maxChars = MAX_LOCAL_CONTEXT_CHARS,
): string {
	if (retrieved.length === 0) {
		return "(no local markdown context found)";
	}
	const blocks: string[] = [];
	let usedChars = 0;
	for (const [index, item] of retrieved.entries()) {
		const block = `[${index + 1}] uri=${item.sourceUri} locator=${item.locator} heading=${item.heading ?? "(none)"}\n${item.content}`;
		const separatorLength = blocks.length === 0 ? 0 : 2;
		if (usedChars + separatorLength + block.length > maxChars) {
			break;
		}
		blocks.push(block);
		usedChars += separatorLength + block.length;
	}
	return blocks.length > 0
		? blocks.join("\n\n")
		: "(local markdown context exceeded the configured size limit)";
}

export function buildWebContext(webResults: EvidenceWebResult[]): string {
	if (webResults.length === 0) {
		return "(no web search context found)";
	}
	return webResults
		.map((item, index) => {
			const content = item.content?.trim()
				? `\nFetched content:\n${item.content}`
				: "";
			return `[W${index + 1}] title=${item.title}\nurl=${item.url}\nsnippet=${item.snippet}${content}`;
		})
		.join("\n\n");
}

export class SearchEvidenceCollector {
	constructor(private readonly deps: SearchEvidenceCollectorDeps) {}

	private async collectWebResults(
		query: string,
		topK: number,
	): Promise<EvidenceWebResult[]> {
		if (!this.deps.webSearchProvider) return [];
		try {
			const service = new WebSearchService(this.deps.webSearchProvider, {
				maxContentLength: 3000,
			});
			const results = await service.search({
				query,
				maxResults: Math.min(topK, 5),
				lang: "ja",
			});
			return await Promise.all(
				results.map(async (result, index) => {
					if (index >= 2) return result;
					try {
						const page = await service.fetchPageContent(result.url);
						return {
							...result,
							content: page.cleanText,
						};
					} catch {
						return result;
					}
				}),
			);
		} catch {
			return [];
		}
	}

	async collect(input: CollectSearchEvidenceInput): Promise<SearchEvidence> {
		const query = input.query.trim();
		const topK = Math.max(1, input.topK);
		const category = input.category?.trim() || undefined;
		const [evaluation, webResults] = await Promise.all([
			evaluateRetrieverCompat(this.deps.retriever, query, {
				topK,
				enableTrigramFallback: true,
				category,
			}),
			this.collectWebResults(query, topK),
		]);
		const retrieved = evaluation.selectedResults;
		const citations = toCitations(retrieved);
		return {
			query,
			category,
			topK,
			evaluation,
			retrieved,
			citations,
			webResults,
			localContext: buildLocalContext(retrieved),
			webContext: buildWebContext(webResults),
		};
	}
}
