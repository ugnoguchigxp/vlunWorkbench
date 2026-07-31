import {
	and,
	asc,
	desc,
	eq,
	gt,
	inArray,
	notInArray,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import type { AppDatabase } from "../../db";
import type { EmbeddingProvider } from "../../providers/types";
import { sourceFragments, sources } from "../../db/schema";
import {
	chunkSourceDocument,
	defaultSourceHash,
	embeddingToBlob,
	finiteOrZero,
	lowerLike,
	minimumSearchTermMatches,
	normalizeSearchTerms,
	type PendingSourceFragmentEmbedding,
	type SourceKind,
	type SourceSearchResult,
	sumSql,
	type UpsertSourceParams,
} from "./source-repository-support";

export type {
	PendingSourceFragmentEmbedding,
	SourceKind,
	SourceSearchResult,
	UpsertSourceParams,
} from "./source-repository-support";
export { normalizeSearchTerms } from "./source-repository-support";

export class SourceRepository {
	constructor(
		private readonly db: AppDatabase,
		private readonly embeddingProvider: EmbeddingProvider,
	) {}

	private async tryEmbed(content: string): Promise<number[] | undefined> {
		try {
			return await this.embeddingProvider.createEmbedding(content);
		} catch {
			return undefined;
		}
	}

	private async replaceSourceFragments(params: {
		sourceId: string;
		title?: string | null;
		body: string;
		embedFragments: boolean;
		metadata?: Record<string, unknown>;
	}): Promise<number> {
		await this.db
			.delete(sourceFragments)
			.where(eq(sourceFragments.sourceId, params.sourceId));

		const chunks = chunkSourceDocument({
			title: params.title,
			body: params.body,
		});
		if (chunks.length === 0) return 0;

		await this.db.insert(sourceFragments).values(
			await Promise.all(
				chunks.map(async (chunk) => {
					const metadataJson = params.metadata ?? {};
					const embedding = params.embedFragments
						? await this.tryEmbed(chunk.content)
						: undefined;
					return {
						sourceId: params.sourceId,
						locator: chunk.locator,
						heading: chunk.heading,
						content: chunk.content,
						metadata: metadataJson,
						embedding: embedding ? embeddingToBlob(embedding) : undefined,
					};
				}),
			),
		);
		return chunks.length;
	}

	private ensureEmbeddingShape(embedding: number[]): void {
		if (embedding.length !== 1536) {
			throw new Error(
				`Embedding dimension mismatch: expected 1536, got ${embedding.length}`,
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

	async upsertSourceDocument(params: UpsertSourceParams): Promise<string> {
		const embedFragments = params.embedFragments ?? true;
		const contentHash =
			params.contentHash ??
			defaultSourceHash(`${params.sourceKind}\n${params.uri}\n${params.body}`);

		const existing = await this.db.query.sources.findFirst({
			where: eq(sources.uri, params.uri),
			columns: { id: true, contentHash: true },
		});

		if (existing) {
			if (existing.contentHash === contentHash) {
				await this.db
					.update(sources)
					.set({
						title: params.title ?? null,
						category: params.category,
						metadata: params.metadata ?? {},
						updatedAt: new Date(),
						lastIndexedAt: new Date(),
					})
					.where(eq(sources.id, existing.id));
				return existing.id;
			}

			await this.db
				.update(sources)
				.set({
					sourceKind: params.sourceKind,
					category: params.category,
					uri: params.uri,
					title: params.title ?? null,
					body: params.body,
					contentHash,
					metadata: params.metadata ?? {},
					updatedAt: new Date(),
					lastIndexedAt: new Date(),
				})
				.where(eq(sources.id, existing.id));
			await this.replaceSourceFragments({
				sourceId: existing.id,
				title: params.title,
				body: params.body,
				embedFragments,
				metadata: params.metadata,
			});
			return existing.id;
		}

		const [inserted] = await this.db
			.insert(sources)
			.values({
				sourceKind: params.sourceKind,
				category: params.category,
				uri: params.uri,
				title: params.title ?? null,
				body: params.body,
				contentHash,
				metadata: params.metadata ?? {},
				lastIndexedAt: new Date(),
			})
			.returning({ id: sources.id });

		await this.replaceSourceFragments({
			sourceId: inserted.id,
			title: params.title,
			body: params.body,
			embedFragments,
			metadata: params.metadata,
		});
		return inserted.id;
	}

	async deleteSourceByUri(uri: string): Promise<void> {
		await this.db.delete(sources).where(eq(sources.uri, uri));
	}

	async deleteStaleSourcesForRoot(params: {
		rootPath: string;
		keepUris: string[];
	}): Promise<number> {
		const normalizedRootPath = params.rootPath;
		const keepSet = [
			...new Set(params.keepUris.map((uri) => uri.trim()).filter(Boolean)),
		];

		const conditions: SQL[] = [
			lowerLike(sources.uri, `${normalizedRootPath}/pages/%`),
		];
		if (keepSet.length > 0) {
			conditions.push(notInArray(sources.uri, keepSet));
		}

		const deleted = await this.db
			.delete(sources)
			.where(and(...conditions))
			.returning({ id: sources.id });
		return deleted.length;
	}

	async listCategories(
		sourceKinds: SourceKind[] = ["wiki"],
	): Promise<string[]> {
		const conditions: SQL[] = [];
		if (sourceKinds.length > 0) {
			conditions.push(inArray(sources.sourceKind, sourceKinds));
		}
		const query = this.db
			.selectDistinct({
				category: sources.category,
			})
			.from(sources)
			.orderBy(asc(sources.category));
		const rows =
			conditions.length > 0
				? await query.where(and(...conditions))
				: await query;
		return rows
			.map((row) => row.category.trim())
			.filter((category) => category.length > 0);
	}

	async countPendingSourceFragmentEmbeddings(
		sourceKinds: SourceKind[] = ["wiki"],
	): Promise<number> {
		const conditions: SQL[] = [sql`${sourceFragments.embedding} IS NULL`];
		if (sourceKinds.length > 0) {
			conditions.push(inArray(sources.sourceKind, sourceKinds));
		}
		const [row] = await this.db
			.select({ count: sql<number>`cast(count(*) as integer)` })
			.from(sourceFragments)
			.innerJoin(sources, eq(sources.id, sourceFragments.sourceId))
			.where(and(...conditions))
			.limit(1);
		return row?.count ?? 0;
	}

	async listPendingSourceFragmentEmbeddings(params: {
		limit: number;
		sourceKinds?: SourceKind[];
		after?: { createdAt: Date; id: string };
	}): Promise<PendingSourceFragmentEmbedding[]> {
		const sourceKinds = params.sourceKinds ?? ["wiki"];
		const conditions: SQL[] = [sql`${sourceFragments.embedding} IS NULL`];
		if (sourceKinds.length > 0) {
			conditions.push(inArray(sources.sourceKind, sourceKinds));
		}
		if (params.after) {
			conditions.push(
				or(
					gt(sourceFragments.createdAt, params.after.createdAt),
					and(
						eq(sourceFragments.createdAt, params.after.createdAt),
						gt(sourceFragments.id, params.after.id),
					),
				) as SQL,
			);
		}

		const rows = await this.db
			.select({
				id: sourceFragments.id,
				sourceId: sourceFragments.sourceId,
				sourceUri: sources.uri,
				sourceTitle: sources.title,
				sourceCategory: sources.category,
				sourceMetadata: sources.metadata,
				locator: sourceFragments.locator,
				content: sourceFragments.content,
				createdAt: sourceFragments.createdAt,
			})
			.from(sourceFragments)
			.innerJoin(sources, eq(sources.id, sourceFragments.sourceId))
			.where(and(...conditions))
			.orderBy(asc(sourceFragments.createdAt), asc(sourceFragments.id))
			.limit(params.limit);

		return rows as PendingSourceFragmentEmbedding[];
	}

	async createEmbeddingForContent(content: string): Promise<number[]> {
		const embedding = await this.embeddingProvider.createEmbedding(content);
		this.ensureEmbeddingShape(embedding);
		return embedding;
	}

	async updateSourceFragmentEmbedding(
		fragmentId: string,
		embedding: number[],
	): Promise<void> {
		this.ensureEmbeddingShape(embedding);
		await this.db
			.update(sourceFragments)
			.set({ embedding: embeddingToBlob(embedding) })
			.where(eq(sourceFragments.id, fragmentId));
	}

	async vectorSearchSourceContent(
		embedding: number[],
		limit: number,
		sourceKinds?: SourceKind[],
		categories?: string[],
	): Promise<SourceSearchResult[]> {
		const embeddingBlob = embeddingToBlob(embedding);
		const distance = sql<number>`vec_distance_cosine(${sourceFragments.embedding}, ${embeddingBlob})`;
		const similarity = sql<number>`(1 - ${distance})`;
		const conditions: SQL[] = [sql`${sourceFragments.embedding} IS NOT NULL`];
		if (sourceKinds && sourceKinds.length > 0) {
			conditions.push(inArray(sources.sourceKind, sourceKinds));
		}
		if (categories && categories.length > 0) {
			conditions.push(inArray(sources.category, categories));
		}

		const rows = await this.db
			.select({
				id: sourceFragments.id,
				sourceId: sourceFragments.sourceId,
				sourceUri: sources.uri,
				sourceTitle: sources.title,
				sourceCategory: sources.category,
				sourceMetadata: sources.metadata,
				locator: sourceFragments.locator,
				heading: sourceFragments.heading,
				content: sourceFragments.content,
				score: similarity,
			})
			.from(sourceFragments)
			.innerJoin(sources, eq(sources.id, sourceFragments.sourceId))
			.where(and(...conditions))
			.orderBy(desc(similarity), desc(sourceFragments.createdAt))
			.limit(limit);

		return rows.map((row) => ({ ...row, score: finiteOrZero(row.score) }));
	}

	async searchSourceContent(
		query: string,
		limit: number,
		sourceKinds?: SourceKind[],
		categories?: string[],
	): Promise<SourceSearchResult[]> {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) return [];
		const searchTerms = normalizeSearchTerms(trimmedQuery);
		const exactPattern = `%${trimmedQuery}%`;
		const minTermMatches = minimumSearchTermMatches(searchTerms.length);

		const exactMatchExpr = or(
			lowerLike(sources.title, exactPattern),
			lowerLike(sourceFragments.heading, exactPattern),
			lowerLike(sourceFragments.content, exactPattern),
			lowerLike(sql`cast(${sourceFragments.metadata} as text)`, exactPattern),
		);
		const termMatchCountExpr = sumSql(
			searchTerms.map((term) => {
				const pattern = `%${term}%`;
				return sql<number>`CASE WHEN (
          ${lowerLike(sources.title, pattern)}
          OR ${lowerLike(sourceFragments.heading, pattern)}
          OR ${lowerLike(sourceFragments.content, pattern)}
          OR ${lowerLike(sql`cast(${sourceFragments.metadata} as text)`, pattern)}
        ) THEN 1 ELSE 0 END`;
			}),
		);
		const termScoreExpr = sumSql(
			searchTerms.map((term) => {
				const pattern = `%${term}%`;
				return sql<number>`(
          CASE WHEN ${lowerLike(sources.title, pattern)} THEN 4 ELSE 0 END
          + CASE WHEN ${lowerLike(sourceFragments.heading, pattern)} THEN 3 ELSE 0 END
          + CASE WHEN ${lowerLike(sourceFragments.content, pattern)} THEN 1 ELSE 0 END
          + CASE WHEN ${lowerLike(sql`cast(${sourceFragments.metadata} as text)`, pattern)} THEN 0.5 ELSE 0 END
        )`;
			}),
		);
		const exactScoreExpr = sql<number>`(
      CASE WHEN ${lowerLike(sources.title, exactPattern)} THEN 8 ELSE 0 END
      + CASE WHEN ${lowerLike(sourceFragments.heading, exactPattern)} THEN 6 ELSE 0 END
      + CASE WHEN ${lowerLike(sourceFragments.content, exactPattern)} THEN 5 ELSE 0 END
      + CASE WHEN ${lowerLike(sql`cast(${sourceFragments.metadata} as text)`, exactPattern)} THEN 1 ELSE 0 END
    )`;
		const scoreExpr = sql<number>`(
      ${exactScoreExpr}
      + ${termScoreExpr}
    )`;

		const conditions = [
			or(exactMatchExpr, sql`${termMatchCountExpr} >= ${minTermMatches}`),
		];
		if (sourceKinds && sourceKinds.length > 0) {
			conditions.push(inArray(sources.sourceKind, sourceKinds));
		}
		if (categories && categories.length > 0) {
			conditions.push(inArray(sources.category, categories));
		}

		const rows = await this.db
			.select({
				id: sourceFragments.id,
				sourceId: sourceFragments.sourceId,
				sourceUri: sources.uri,
				sourceTitle: sources.title,
				sourceCategory: sources.category,
				sourceMetadata: sources.metadata,
				locator: sourceFragments.locator,
				heading: sourceFragments.heading,
				content: sourceFragments.content,
				score: scoreExpr,
			})
			.from(sourceFragments)
			.innerJoin(sources, eq(sources.id, sourceFragments.sourceId))
			.where(and(...conditions))
			.orderBy(desc(scoreExpr), desc(sourceFragments.createdAt))
			.limit(limit);

		return rows.map((row) => ({ ...row, score: finiteOrZero(row.score) }));
	}

	async getFragmentById(fragmentId: string) {
		const rows = await this.db
			.select({
				id: sourceFragments.id,
				sourceId: sourceFragments.sourceId,
				locator: sourceFragments.locator,
				heading: sourceFragments.heading,
				content: sourceFragments.content,
				metadata: sourceFragments.metadata,
				source: {
					id: sources.id,
					uri: sources.uri,
					title: sources.title,
				},
			})
			.from(sourceFragments)
			.innerJoin(sources, eq(sources.id, sourceFragments.sourceId))
			.where(eq(sourceFragments.id, fragmentId))
			.limit(1);

		return rows[0] ?? null;
	}

	async getSourceById(sourceId: string) {
		const rows = await this.db
			.select({
				id: sources.id,
				uri: sources.uri,
				title: sources.title,
				body: sources.body,
				category: sources.category,
				metadata: sources.metadata,
				sourceKind: sources.sourceKind,
			})
			.from(sources)
			.where(eq(sources.id, sourceId))
			.limit(1);
		return rows[0] ?? null;
	}

	async getSourceByUri(uri: string) {
		const rows = await this.db
			.select({
				id: sources.id,
				uri: sources.uri,
				title: sources.title,
				body: sources.body,
				category: sources.category,
				metadata: sources.metadata,
				sourceKind: sources.sourceKind,
			})
			.from(sources)
			.where(eq(sources.uri, uri))
			.limit(1);
		return rows[0] ?? null;
	}
}
