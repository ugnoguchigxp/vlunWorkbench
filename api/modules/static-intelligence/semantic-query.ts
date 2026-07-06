import type {
	StaticIntelligenceSemanticQueryResult,
	StaticIntelligenceSemanticQueryResultItem,
} from "../../../shared/schemas/static-intelligence-search.schema";
import { staticIntelligenceSemanticQueryResultSchema } from "../../../shared/schemas/static-intelligence-search.schema";
import type { AppDatabase } from "../../db";
import type { EmbeddingProvider } from "../../providers/types";
import {
	ensureEmbeddingShape,
	normalizeEmbeddingMetadata,
	type StaticIntelligenceEmbeddingFilters,
	StaticIntelligenceEmbeddingRepository,
	type StaticIntelligenceVectorSearchRow,
} from "./embedding-repository";

export type StaticIntelligenceSemanticQueryOptions = {
	topK?: number;
	filters?: StaticIntelligenceEmbeddingFilters;
};

export async function runStaticIntelligenceSemanticQuery(params: {
	db: AppDatabase;
	scanRunId: string;
	query: string;
	embeddingProvider?: EmbeddingProvider;
	options?: StaticIntelligenceSemanticQueryOptions;
}): Promise<StaticIntelligenceSemanticQueryResult> {
	const topK = params.options?.topK ?? 10;
	const trimmedQuery = params.query.trim();
	const repository = new StaticIntelligenceEmbeddingRepository(params.db);
	const scanRunExists = await repository.scanRunExists(params.scanRunId);
	if (!scanRunExists)
		throw new Error(`Scan run not found: ${params.scanRunId}`);

	const indexedCount = await repository.countIndexedRows(
		params.scanRunId,
		params.options?.filters ?? {},
	);
	if (indexedCount === 0) {
		const totalIndexedCount = await repository.countIndexedRows(
			params.scanRunId,
		);
		return staticIntelligenceSemanticQueryResultSchema.parse({
			ok: true,
			status: "completed",
			scanRunId: params.scanRunId,
			query: trimmedQuery,
			topK,
			results: [],
			degradedReasons: [
				totalIndexedCount === 0
					? "static intelligence embedding index is empty"
					: "no static intelligence embedding rows matched the provided filters",
			],
		});
	}
	if (!params.embeddingProvider) {
		throw new Error("Embedding provider is required for semantic query.");
	}

	const embedding =
		await params.embeddingProvider.createEmbedding(trimmedQuery);
	ensureEmbeddingShape(embedding);
	const rows = await repository.vectorSearch({
		scanRunId: params.scanRunId,
		embedding,
		limit: Math.max(topK * 3, topK),
		filters: params.options?.filters,
	});
	const terms = queryTerms(trimmedQuery);
	const results = rows
		.map((row) => toResultItem(row, params.options?.filters ?? {}, terms))
		.sort((a, b) => {
			const scoreDiff = b.score - a.score;
			if (scoreDiff !== 0) return scoreDiff;
			return a.sourceRef.localeCompare(b.sourceRef);
		})
		.slice(0, topK);

	return staticIntelligenceSemanticQueryResultSchema.parse({
		ok: true,
		status: "completed",
		scanRunId: params.scanRunId,
		query: trimmedQuery,
		topK,
		results,
		degradedReasons:
			results.length === 0
				? ["no searchable static intelligence embeddings matched the query"]
				: [],
	});
}

function toResultItem(
	row: StaticIntelligenceVectorSearchRow,
	filters: StaticIntelligenceEmbeddingFilters,
	terms: string[],
): StaticIntelligenceSemanticQueryResultItem {
	const metadata = normalizeEmbeddingMetadata(row.metadata);
	const exactScore = computeExactScore(row, metadata, filters, terms);
	const score = row.vectorScore + exactScore;
	return {
		id: row.id,
		sourceKind: row.sourceKind,
		sourceId: row.sourceId,
		sourceRef: row.sourceRef,
		title: row.title,
		score,
		vectorScore: row.vectorScore,
		exactScore,
		candidateOnly: true,
		relatedFindingIds: arrayMetadata(metadata.findingIds),
		evidenceRefs: arrayMetadata(metadata.evidenceRefs),
		artifactRefs: arrayMetadata(metadata.artifactRefs),
		...(typeof metadata.filePath === "string"
			? { filePath: metadata.filePath }
			: {}),
		metadata: safeSemanticMetadata(metadata),
	};
}

function computeExactScore(
	row: StaticIntelligenceVectorSearchRow,
	metadata: ReturnType<typeof normalizeEmbeddingMetadata>,
	filters: StaticIntelligenceEmbeddingFilters,
	terms: string[],
): number {
	let score = 0;
	if (filters.file && metadata.filePath === filters.file) score += 0.2;
	if (filters.ruleId && metadata.ruleId === filters.ruleId) score += 0.2;
	if (filters.scanner && metadata.scanner === filters.scanner) score += 0.1;
	const haystack = `${row.title}\n${row.content}`.toLowerCase();
	const termMatches = terms.filter((term) => haystack.includes(term)).length;
	if (terms.length > 0) {
		score += Math.min(0.1, (termMatches / terms.length) * 0.1);
	}
	return score;
}

function queryTerms(query: string): string[] {
	const tokens =
		query
			.normalize("NFKC")
			.toLowerCase()
			.match(
				/(?:--?)?[a-z0-9][a-z0-9._:/@+-]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/giu,
			) ?? [];
	return [
		...new Set(tokens.map((token) => token.trim()).filter(Boolean)),
	].slice(0, 12);
}

function arrayMetadata(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string")
		.sort();
}

function safeSemanticMetadata(
	metadata: ReturnType<typeof normalizeEmbeddingMetadata>,
): Record<string, unknown> {
	return {
		candidateOnly: true,
		findingIds: arrayMetadata(metadata.findingIds),
		evidenceRefs: arrayMetadata(metadata.evidenceRefs),
		artifactRefs: arrayMetadata(metadata.artifactRefs),
		...(typeof metadata.filePath === "string"
			? { filePath: metadata.filePath }
			: {}),
		...(typeof metadata.severity === "string"
			? { severity: metadata.severity }
			: {}),
		...(typeof metadata.ruleId === "string" ? { ruleId: metadata.ruleId } : {}),
		...(typeof metadata.scanner === "string"
			? { scanner: metadata.scanner }
			: {}),
		...(Array.isArray(metadata.degradedReasons)
			? { degradedReasons: arrayMetadata(metadata.degradedReasons) }
			: {}),
	};
}
