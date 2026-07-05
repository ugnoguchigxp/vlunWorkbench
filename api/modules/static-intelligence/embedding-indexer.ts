import type { StaticIntelligenceEmbeddingIndexResult } from "../../../shared/schemas/static-intelligence-search.schema";
import { staticIntelligenceEmbeddingIndexResultSchema } from "../../../shared/schemas/static-intelligence-search.schema";
import type { AppDatabase } from "../../db";
import { EMBEDDING_DIMENSIONS } from "../../db/schema";
import type { EmbeddingProvider } from "../../providers/types";
import { buildStaticIntelligenceExportFromBundle } from "./export-builder";
import { buildStaticIntelligenceEmbeddingSources } from "./embedding-source-builder";
import {
	ensureEmbeddingShape,
	StaticIntelligenceEmbeddingRepository,
	sourceKey,
} from "./embedding-repository";
import { StaticIntelligenceRepository } from "./repository";

export type StaticIntelligenceIndexOptions = {
	force?: boolean;
	limit?: number;
	embeddingModel: string;
	embeddingDim?: number;
};

export async function indexStaticIntelligenceEmbeddings(params: {
	db: AppDatabase;
	scanRunId: string;
	embeddingProvider: EmbeddingProvider;
	options: StaticIntelligenceIndexOptions;
}): Promise<StaticIntelligenceEmbeddingIndexResult> {
	const sourceRepository = new StaticIntelligenceRepository(params.db);
	const bundle = await sourceRepository.loadSourceBundle(params.scanRunId);
	if (!bundle) {
		throw new Error(`Scan run not found: ${params.scanRunId}`);
	}

	const embeddingDim = params.options.embeddingDim ?? EMBEDDING_DIMENSIONS;
	const exportPayload = buildStaticIntelligenceExportFromBundle(bundle);
	const allSources = buildStaticIntelligenceEmbeddingSources(
		exportPayload,
		bundle,
	);
	const sourcesToConsider =
		params.options.limit === undefined
			? allSources
			: allSources.slice(0, params.options.limit);

	const embeddingRepository = new StaticIntelligenceEmbeddingRepository(
		params.db,
	);
	const existingRows = await embeddingRepository.listExistingRows(
		params.scanRunId,
	);
	const existingByKey = new Map(
		existingRows.map((row) => [sourceKey(row), row]),
	);

	const sourcesToIndex = sourcesToConsider.filter((source) => {
		const existing = existingByKey.get(sourceKey(source));
		if (!existing) return true;
		if (params.options.force) return true;
		return (
			existing.contentHash !== source.contentHash ||
			existing.embeddingModel !== params.options.embeddingModel ||
			existing.embeddingDim !== embeddingDim
		);
	});

	const embeddedSources = [];
	for (const source of sourcesToIndex) {
		const embedding = await params.embeddingProvider.createEmbedding(
			source.content,
		);
		ensureEmbeddingShape(embedding, embeddingDim);
		embeddedSources.push({ source, embedding });
	}

	let indexed = 0;
	let staleReplaced = 0;
	for (const item of embeddedSources) {
		const existing = existingByKey.get(sourceKey(item.source));
		await embeddingRepository.replaceEmbeddingRow({
			source: item.source,
			embedding: item.embedding,
			embeddingModel: params.options.embeddingModel,
			embeddingDim,
		});
		if (existing) {
			staleReplaced += 1;
		} else {
			indexed += 1;
		}
	}

	const deleted = await embeddingRepository.deleteMissingSources({
		scanRunId: params.scanRunId,
		keepSources: allSources,
	});
	const skipped = sourcesToConsider.length - sourcesToIndex.length;

	return staticIntelligenceEmbeddingIndexResultSchema.parse({
		ok: true,
		status: "completed",
		scanRunId: params.scanRunId,
		indexed,
		skipped,
		staleReplaced,
		deleted,
		embeddingModel: params.options.embeddingModel,
		embeddingDim,
	});
}
