import { z } from "zod";

export const staticIntelligenceEmbeddingSourceKindSchema = z.enum([
	"finding",
	"evidence",
	"scan_review",
	"improvement_request",
	"file_risk_summary",
]);
export type StaticIntelligenceEmbeddingSourceKind = z.infer<
	typeof staticIntelligenceEmbeddingSourceKindSchema
>;

export const staticIntelligenceEmbeddingSourceMetadataSchema = z
	.object({
		findingIds: z.array(z.string()).optional(),
		evidenceRefs: z.array(z.string()).optional(),
		artifactRefs: z.array(z.string()).optional(),
		filePath: z.string().optional(),
		severity: z.string().optional(),
		ruleId: z.string().optional(),
		scanner: z.string().optional(),
		degradedReasons: z.array(z.string()).optional(),
		candidateOnly: z.literal(true),
	})
	.catchall(z.unknown());
export type StaticIntelligenceEmbeddingSourceMetadata = z.infer<
	typeof staticIntelligenceEmbeddingSourceMetadataSchema
>;

export const staticIntelligenceEmbeddingSourceSchema = z.object({
	projectId: z.string(),
	scanRunId: z.string(),
	sourceKind: staticIntelligenceEmbeddingSourceKindSchema,
	sourceId: z.string(),
	sourceRef: z.string(),
	title: z.string(),
	content: z.string(),
	contentHash: z.string(),
	metadata: staticIntelligenceEmbeddingSourceMetadataSchema,
});
export type StaticIntelligenceEmbeddingSource = z.infer<
	typeof staticIntelligenceEmbeddingSourceSchema
>;

export const staticIntelligenceEmbeddingIndexResultSchema = z.object({
	ok: z.literal(true),
	status: z.literal("completed"),
	scanRunId: z.string(),
	indexed: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	staleReplaced: z.number().int().nonnegative(),
	deleted: z.number().int().nonnegative(),
	embeddingModel: z.string(),
	embeddingDim: z.number().int().positive(),
});
export type StaticIntelligenceEmbeddingIndexResult = z.infer<
	typeof staticIntelligenceEmbeddingIndexResultSchema
>;

export const staticIntelligenceSemanticQueryResultItemSchema = z.object({
	id: z.string(),
	sourceKind: z.string(),
	sourceId: z.string(),
	sourceRef: z.string(),
	title: z.string(),
	score: z.number(),
	vectorScore: z.number(),
	exactScore: z.number(),
	candidateOnly: z.literal(true),
	relatedFindingIds: z.array(z.string()),
	evidenceRefs: z.array(z.string()),
	artifactRefs: z.array(z.string()),
	filePath: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()),
});
export type StaticIntelligenceSemanticQueryResultItem = z.infer<
	typeof staticIntelligenceSemanticQueryResultItemSchema
>;

export const staticIntelligenceSemanticQueryResultSchema = z.object({
	ok: z.literal(true),
	status: z.literal("completed"),
	scanRunId: z.string(),
	query: z.string(),
	topK: z.number().int().positive(),
	results: z.array(staticIntelligenceSemanticQueryResultItemSchema),
	degradedReasons: z.array(z.string()),
});
export type StaticIntelligenceSemanticQueryResult = z.infer<
	typeof staticIntelligenceSemanticQueryResultSchema
>;
