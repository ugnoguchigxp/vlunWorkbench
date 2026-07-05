import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
	type StaticIntelligenceEmbeddingSource,
	staticIntelligenceEmbeddingSourceKindSchema,
	type StaticIntelligenceEmbeddingSourceKind,
	type StaticIntelligenceEmbeddingSourceMetadata,
} from "../../../shared/schemas/static-intelligence-search.schema";
import type { AppDatabase } from "../../db";
import { EMBEDDING_DIMENSIONS } from "../../db/schema";
import { scanRuns, staticIntelligenceEmbeddings } from "../../db/schema";

export type StaticIntelligenceEmbeddingRow =
	typeof staticIntelligenceEmbeddings.$inferSelect;

export type StaticIntelligenceEmbeddingFilters = {
	sourceKinds?: StaticIntelligenceEmbeddingSourceKind[];
	file?: string;
	ruleId?: string;
	scanner?: string;
};

export type StaticIntelligenceVectorSearchRow =
	StaticIntelligenceEmbeddingRow & {
		vectorScore: number;
	};

export function embeddingToBlob(embedding: number[]): Buffer {
	return Buffer.from(new Float32Array(embedding).buffer);
}

export function ensureEmbeddingShape(
	embedding: number[],
	expectedDim = EMBEDDING_DIMENSIONS,
): void {
	if (embedding.length !== expectedDim) {
		throw new Error(
			`Embedding dimension mismatch: expected ${expectedDim}, got ${embedding.length}`,
		);
	}
	if (
		!embedding.every(
			(value) => typeof value === "number" && Number.isFinite(value),
		)
	) {
		throw new Error("Invalid embedding values.");
	}
}

export class StaticIntelligenceEmbeddingRepository {
	constructor(private readonly db: AppDatabase) {}

	async scanRunExists(scanRunId: string): Promise<boolean> {
		const row = await this.db.query.scanRuns.findFirst({
			where: eq(scanRuns.id, scanRunId),
			columns: { id: true },
		});
		return Boolean(row);
	}

	async listExistingRows(
		scanRunId: string,
	): Promise<StaticIntelligenceEmbeddingRow[]> {
		return await this.db.query.staticIntelligenceEmbeddings.findMany({
			where: eq(staticIntelligenceEmbeddings.scanRunId, scanRunId),
			orderBy: (fields, { asc }) => [
				asc(fields.sourceKind),
				asc(fields.sourceRef),
			],
		});
	}

	async countIndexedRows(
		scanRunId: string,
		filters: StaticIntelligenceEmbeddingFilters = {},
	): Promise<number> {
		const conditions = [
			...this.buildConditions(scanRunId, filters),
			sql`${staticIntelligenceEmbeddings.embedding} IS NOT NULL`,
		];
		const [row] = await this.db
			.select({ count: sql<number>`cast(count(*) as integer)` })
			.from(staticIntelligenceEmbeddings)
			.where(and(...conditions))
			.limit(1);
		return row?.count ?? 0;
	}

	async replaceEmbeddingRow(params: {
		source: StaticIntelligenceEmbeddingSource;
		embedding: number[];
		embeddingModel: string;
		embeddingDim?: number;
	}): Promise<void> {
		const embeddingDim = params.embeddingDim ?? EMBEDDING_DIMENSIONS;
		ensureEmbeddingShape(params.embedding, embeddingDim);
		const now = new Date();
		await this.db
			.insert(staticIntelligenceEmbeddings)
			.values({
				projectId: params.source.projectId,
				scanRunId: params.source.scanRunId,
				sourceKind: params.source.sourceKind,
				sourceId: params.source.sourceId,
				sourceRef: params.source.sourceRef,
				title: params.source.title,
				content: params.source.content,
				contentHash: params.source.contentHash,
				embedding: embeddingToBlob(params.embedding),
				embeddingModel: params.embeddingModel,
				embeddingDim,
				metadata: params.source.metadata,
				indexedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: [
					staticIntelligenceEmbeddings.scanRunId,
					staticIntelligenceEmbeddings.sourceKind,
					staticIntelligenceEmbeddings.sourceId,
				],
				set: {
					projectId: params.source.projectId,
					sourceRef: params.source.sourceRef,
					title: params.source.title,
					content: params.source.content,
					contentHash: params.source.contentHash,
					embedding: embeddingToBlob(params.embedding),
					embeddingModel: params.embeddingModel,
					embeddingDim,
					metadata: params.source.metadata,
					indexedAt: now,
					updatedAt: now,
				},
			});
	}

	async deleteMissingSources(params: {
		scanRunId: string;
		keepSources: StaticIntelligenceEmbeddingSource[];
	}): Promise<number> {
		const keepKeys = new Set(params.keepSources.map(sourceKey));
		const existing = await this.listExistingRows(params.scanRunId);
		const staleRows = existing.filter((row) => !keepKeys.has(sourceKey(row)));
		for (const row of staleRows) {
			await this.db
				.delete(staticIntelligenceEmbeddings)
				.where(eq(staticIntelligenceEmbeddings.id, row.id));
		}
		return staleRows.length;
	}

	async vectorSearch(params: {
		scanRunId: string;
		embedding: number[];
		limit: number;
		filters?: StaticIntelligenceEmbeddingFilters;
	}): Promise<StaticIntelligenceVectorSearchRow[]> {
		ensureEmbeddingShape(params.embedding);
		const embeddingBlob = embeddingToBlob(params.embedding);
		const distance = sql<number>`vec_distance_cosine(${staticIntelligenceEmbeddings.embedding}, ${embeddingBlob})`;
		const similarity = sql<number>`(1 - ${distance})`;
		const conditions = [
			...this.buildConditions(params.scanRunId, params.filters ?? {}),
			sql`${staticIntelligenceEmbeddings.embedding} IS NOT NULL`,
		];

		const rows = await this.db
			.select({
				id: staticIntelligenceEmbeddings.id,
				projectId: staticIntelligenceEmbeddings.projectId,
				scanRunId: staticIntelligenceEmbeddings.scanRunId,
				sourceKind: staticIntelligenceEmbeddings.sourceKind,
				sourceId: staticIntelligenceEmbeddings.sourceId,
				sourceRef: staticIntelligenceEmbeddings.sourceRef,
				title: staticIntelligenceEmbeddings.title,
				content: staticIntelligenceEmbeddings.content,
				contentHash: staticIntelligenceEmbeddings.contentHash,
				embedding: staticIntelligenceEmbeddings.embedding,
				embeddingModel: staticIntelligenceEmbeddings.embeddingModel,
				embeddingDim: staticIntelligenceEmbeddings.embeddingDim,
				metadata: staticIntelligenceEmbeddings.metadata,
				indexedAt: staticIntelligenceEmbeddings.indexedAt,
				createdAt: staticIntelligenceEmbeddings.createdAt,
				updatedAt: staticIntelligenceEmbeddings.updatedAt,
				vectorScore: similarity,
			})
			.from(staticIntelligenceEmbeddings)
			.where(and(...conditions))
			.orderBy(desc(similarity), desc(staticIntelligenceEmbeddings.updatedAt))
			.limit(params.limit);

		return rows.map((row) => ({
			...row,
			vectorScore: finiteOrZero(row.vectorScore),
		}));
	}

	private buildConditions(
		scanRunId: string,
		filters: StaticIntelligenceEmbeddingFilters,
	): SQL[] {
		const conditions: SQL[] = [
			eq(staticIntelligenceEmbeddings.scanRunId, scanRunId),
		];
		if (filters.sourceKinds && filters.sourceKinds.length > 0) {
			conditions.push(
				inArray(staticIntelligenceEmbeddings.sourceKind, filters.sourceKinds),
			);
		}
		if (filters.file) {
			conditions.push(
				sql`json_extract(${staticIntelligenceEmbeddings.metadata}, '$.filePath') = ${filters.file}`,
			);
		}
		if (filters.ruleId) {
			conditions.push(
				sql`json_extract(${staticIntelligenceEmbeddings.metadata}, '$.ruleId') = ${filters.ruleId}`,
			);
		}
		if (filters.scanner) {
			conditions.push(
				sql`json_extract(${staticIntelligenceEmbeddings.metadata}, '$.scanner') = ${filters.scanner}`,
			);
		}
		return conditions;
	}
}

export function parseSourceKindsCsv(
	value: string | undefined,
): StaticIntelligenceEmbeddingSourceKind[] | undefined {
	if (!value) return undefined;
	const kinds = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	if (kinds.length === 0) return undefined;
	return kinds.map((kind) =>
		staticIntelligenceEmbeddingSourceKindSchema.parse(kind),
	);
}

export function sourceKey(
	source:
		| Pick<StaticIntelligenceEmbeddingSource, "sourceKind" | "sourceId">
		| Pick<StaticIntelligenceEmbeddingRow, "sourceKind" | "sourceId">,
): string {
	return `${source.sourceKind}\0${source.sourceId}`;
}

export function normalizeEmbeddingMetadata(
	value: unknown,
): StaticIntelligenceEmbeddingSourceMetadata {
	if (!value || typeof value !== "object") return { candidateOnly: true };
	return {
		...(value as Record<string, unknown>),
		candidateOnly: true,
	} as StaticIntelligenceEmbeddingSourceMetadata;
}

function finiteOrZero(value: unknown): number {
	const num = Number(value);
	return Number.isFinite(num) ? num : 0;
}
