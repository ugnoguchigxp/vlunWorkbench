import type { EmbeddingProvider } from "../../providers/types";
import type { SourceRepository } from "../sources/source.repository";
import { resolveWikiLinkRef } from "../sources/wiki/link-ref";
import type { RetrievedFragment } from "./types";

const RRF_CONSTANT = 60;

export type RetrieveOptions = {
	topK: number;
	enableTrigramFallback?: boolean;
	category?: string;
};

export type RetrievalBreakdown = {
	vectorResults: RetrievedFragment[];
	textResults: RetrievedFragment[];
	mergedResults: RetrievedFragment[];
};

export type RetrievalEvaluation = RetrievalBreakdown & {
	selectedResults: RetrievedFragment[];
	strategy: "merged" | "text_fallback" | "legacy_retrieve";
};

function mergeRrf(
	vectorResults: Array<{
		id: string;
		sourceId: string;
		sourceUri: string;
		sourceCategory: string;
		sourceMetadata: unknown;
		locator: string;
		heading: string | null;
		content: string;
		score: number;
	}>,
	textResults: Array<{
		id: string;
		sourceId: string;
		sourceUri: string;
		sourceCategory: string;
		sourceMetadata: unknown;
		locator: string;
		heading: string | null;
		content: string;
		score: number;
	}>,
	topK: number,
): RetrievedFragment[] {
	const merged = new Map<string, RetrievedFragment>();

	vectorResults.forEach((result, index) => {
		const rank = index + 1;
		const rrfScore = 1 / (RRF_CONSTANT + rank);
		const linkRef = resolveWikiLinkRef({
			sourceUri: result.sourceUri,
			sourceMetadata: result.sourceMetadata,
			sourceCategory: result.sourceCategory,
		});
		merged.set(result.id, {
			id: result.id,
			sourceId: result.sourceId,
			sourceUri: result.sourceUri,
			sourceCategory: result.sourceCategory,
			locator: result.locator,
			heading: result.heading,
			content: result.content,
			vectorScore: result.score,
			combinedScore: rrfScore,
			wikiSlug: linkRef?.wikiSlug ?? null,
			wikiApiPath: linkRef?.wikiApiPath ?? null,
			wikiRawPath: linkRef?.wikiRawPath ?? null,
		});
	});

	textResults.forEach((result, index) => {
		const rank = index + 1;
		const rrfScore = 1 / (RRF_CONSTANT + rank);
		const linkRef = resolveWikiLinkRef({
			sourceUri: result.sourceUri,
			sourceMetadata: result.sourceMetadata,
			sourceCategory: result.sourceCategory,
		});
		const existing = merged.get(result.id);
		if (existing) {
			existing.textScore = result.score;
			existing.combinedScore += rrfScore;
			if (!existing.wikiSlug) {
				existing.wikiSlug = linkRef?.wikiSlug ?? null;
				existing.wikiApiPath = linkRef?.wikiApiPath ?? null;
				existing.wikiRawPath = linkRef?.wikiRawPath ?? null;
			}
		} else {
			merged.set(result.id, {
				id: result.id,
				sourceId: result.sourceId,
				sourceUri: result.sourceUri,
				sourceCategory: result.sourceCategory,
				locator: result.locator,
				heading: result.heading,
				content: result.content,
				textScore: result.score,
				combinedScore: rrfScore,
				wikiSlug: linkRef?.wikiSlug ?? null,
				wikiApiPath: linkRef?.wikiApiPath ?? null,
				wikiRawPath: linkRef?.wikiRawPath ?? null,
			});
		}
	});

	return [...merged.values()]
		.sort((a, b) => b.combinedScore - a.combinedScore)
		.slice(0, topK);
}

function toSourceAggregationKey(item: RetrievedFragment): string {
	return item.wikiSlug ?? item.sourceId ?? item.sourceUri;
}

function aggregateFragmentsBySource(
	fragments: RetrievedFragment[],
	topK: number,
): RetrievedFragment[] {
	const aggregated = new Map<string, RetrievedFragment>();
	for (const fragment of fragments) {
		const key = toSourceAggregationKey(fragment);
		const existing = aggregated.get(key);
		if (!existing) {
			aggregated.set(key, {
				...fragment,
				sourceHitCount: 1,
			});
			continue;
		}
		existing.sourceHitCount = (existing.sourceHitCount ?? 1) + 1;
	}
	return [...aggregated.values()].slice(0, topK);
}

function toVectorFragments(
	results: Array<{
		id: string;
		sourceId: string;
		sourceUri: string;
		sourceCategory: string;
		sourceMetadata: unknown;
		locator: string;
		heading: string | null;
		content: string;
		score: number;
	}>,
	topK: number,
): RetrievedFragment[] {
	const fragments = results.map((item) => {
		const linkRef = resolveWikiLinkRef({
			sourceUri: item.sourceUri,
			sourceMetadata: item.sourceMetadata,
			sourceCategory: item.sourceCategory,
		});
		return {
			id: item.id,
			sourceId: item.sourceId,
			sourceUri: item.sourceUri,
			sourceCategory: item.sourceCategory,
			locator: item.locator,
			heading: item.heading,
			content: item.content,
			vectorScore: item.score,
			combinedScore: item.score,
			wikiSlug: linkRef?.wikiSlug ?? null,
			wikiApiPath: linkRef?.wikiApiPath ?? null,
			wikiRawPath: linkRef?.wikiRawPath ?? null,
		};
	});
	return aggregateFragmentsBySource(fragments, topK);
}

function toTextFragments(
	results: Array<{
		id: string;
		sourceId: string;
		sourceUri: string;
		sourceCategory: string;
		sourceMetadata: unknown;
		locator: string;
		heading: string | null;
		content: string;
		score: number;
	}>,
	topK: number,
): RetrievedFragment[] {
	const fragments = results.map((item) => {
		const linkRef = resolveWikiLinkRef({
			sourceUri: item.sourceUri,
			sourceMetadata: item.sourceMetadata,
			sourceCategory: item.sourceCategory,
		});
		return {
			id: item.id,
			sourceId: item.sourceId,
			sourceUri: item.sourceUri,
			sourceCategory: item.sourceCategory,
			locator: item.locator,
			heading: item.heading,
			content: item.content,
			textScore: item.score,
			combinedScore: item.score,
			wikiSlug: linkRef?.wikiSlug ?? null,
			wikiApiPath: linkRef?.wikiApiPath ?? null,
			wikiRawPath: linkRef?.wikiRawPath ?? null,
		};
	});
	return aggregateFragmentsBySource(fragments, topK);
}

function withTextFallback(
	textResults: RetrievedFragment[],
	topK: number,
): RetrievedFragment[] {
	return textResults.slice(0, topK).map((item, index) => ({
		...item,
		trigramScore: item.textScore,
		combinedScore: 1 / (RRF_CONSTANT + index + 1),
	}));
}

export class SourceRetriever {
	constructor(
		private readonly sourceRepository: SourceRepository,
		private readonly embeddingProvider: EmbeddingProvider,
	) {}

	async retrieve(
		query: string,
		options: RetrieveOptions,
	): Promise<RetrievedFragment[]> {
		const evaluation = await this.evaluate(query, options);
		return evaluation.selectedResults;
	}

	async retrieveBreakdown(
		query: string,
		options: RetrieveOptions,
	): Promise<RetrievalBreakdown> {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			return {
				vectorResults: [],
				textResults: [],
				mergedResults: [],
			};
		}
		const topK = Math.max(1, options.topK);
		const fetchK = topK * 5;
		const normalizedCategory = options.category?.trim();
		const categories =
			normalizedCategory && normalizedCategory.length > 0
				? [normalizedCategory]
				: undefined;
		const textResultsPromise = this.sourceRepository.searchSourceContent(
			trimmedQuery,
			fetchK,
			["wiki"],
			categories,
		);
		const vectorResultsPromise = (async () => {
			try {
				const embedding =
					await this.embeddingProvider.createEmbedding(trimmedQuery);
				return await this.sourceRepository.vectorSearchSourceContent(
					embedding,
					fetchK,
					["wiki"],
					categories,
				);
			} catch {
				return [];
			}
		})();
		const [vectorResults, textResults] = await Promise.all([
			vectorResultsPromise,
			textResultsPromise,
		]);

		const merged = mergeRrf(vectorResults, textResults, topK);
		return {
			vectorResults: toVectorFragments(vectorResults, topK),
			textResults: toTextFragments(textResults, topK),
			mergedResults: merged,
		};
	}

	async evaluate(
		query: string,
		options: RetrieveOptions,
	): Promise<RetrievalEvaluation> {
		const topK = Math.max(1, options.topK);
		const breakdown = await this.retrieveBreakdown(query, options);
		if (breakdown.mergedResults.length > 0 || !options.enableTrigramFallback) {
			return {
				...breakdown,
				selectedResults: breakdown.mergedResults,
				strategy: "merged",
			};
		}
		return {
			...breakdown,
			selectedResults: withTextFallback(breakdown.textResults, topK),
			strategy: "text_fallback",
		};
	}
}

export async function evaluateRetrieverCompat(
	retriever: SourceRetriever,
	query: string,
	options: RetrieveOptions,
): Promise<RetrievalEvaluation> {
	const typedRetriever = retriever as SourceRetriever & {
		evaluate?: (
			query: string,
			options: RetrieveOptions,
		) => Promise<RetrievalEvaluation>;
		retrieveBreakdown?: (
			query: string,
			options: RetrieveOptions,
		) => Promise<RetrievalBreakdown>;
	};
	if (typeof typedRetriever.evaluate === "function") {
		return typedRetriever.evaluate(query, options);
	}
	if (typeof typedRetriever.retrieveBreakdown === "function") {
		const topK = Math.max(1, options.topK);
		const breakdown = await typedRetriever.retrieveBreakdown(query, options);
		if (breakdown.mergedResults.length > 0 || !options.enableTrigramFallback) {
			return {
				...breakdown,
				selectedResults: breakdown.mergedResults,
				strategy: "merged",
			};
		}
		return {
			...breakdown,
			selectedResults: withTextFallback(breakdown.textResults, topK),
			strategy: "text_fallback",
		};
	}
	const merged = await retriever.retrieve(query, options);
	return {
		vectorResults: [],
		textResults: [],
		mergedResults: merged,
		selectedResults: merged,
		strategy: "legacy_retrieve",
	};
}
