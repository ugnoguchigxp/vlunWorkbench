import { z } from "zod";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceRiskBandSchema,
} from "../../../shared/schemas/static-intelligence.schema";
import { projectExplorationCatalogFailureReasonSchema } from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import { staticIntelligenceGuardrailMaterialTypeSchema } from "../../../shared/schemas/static-intelligence-guardrail-material.schema";

export const projectPathInputSchema = z
	.object({
		projectPath: z.string().min(1).max(4096),
	})
	.strict();
export type ProjectPathInput = z.output<typeof projectPathInputSchema>;

export const prepareProjectIntelligenceInputSchema = projectPathInputSchema;
export const getProjectIntelligenceStatusInputSchema = projectPathInputSchema;

export const listKnowledgeSourcesInputSchema = z
	.object({
		projectId: z.string().trim().min(1).optional(),
		rootRef: z
			.string()
			.regex(/^[a-f0-9]{64}$/)
			.optional(),
		limit: z.number().int().min(1).max(100).optional(),
	})
	.strict();
export type ListKnowledgeSourcesInput = z.output<
	typeof listKnowledgeSourcesInputSchema
>;

export const getKnowledgeSourceManifestInputSchema = projectPathInputSchema;
export type GetKnowledgeSourceManifestInput = z.output<
	typeof getKnowledgeSourceManifestInputSchema
>;

export const getGuardrailMaterialInputSchema = projectPathInputSchema.extend({
	type: staticIntelligenceGuardrailMaterialTypeSchema.optional(),
	includeMarkdown: z.boolean().optional(),
});
export type GetGuardrailMaterialInput = z.output<
	typeof getGuardrailMaterialInputSchema
>;

export const getEvidenceBundleInputSchema = projectPathInputSchema.extend({
	findingFingerprint: z.string().trim().min(1).max(512),
});
export type GetEvidenceBundleInput = z.output<
	typeof getEvidenceBundleInputSchema
>;

export const getVerificationCommandsInputSchema = projectPathInputSchema.extend(
	{
		findingFingerprint: z.string().trim().min(1).max(512).optional(),
	},
);
export type GetVerificationCommandsInput = z.output<
	typeof getVerificationCommandsInputSchema
>;

const projectStructureViewSchema = z.enum(["summary", "files", "references"]);
const projectStructureSnapshotOptionsSchema = z.object({
	view: projectStructureViewSchema.default("summary"),
	cursor: z.number().int().nonnegative().default(0),
	limit: z.number().int().min(1).max(200).default(100),
});
export const getProjectStructureSnapshotInputSchema = projectPathInputSchema
	.merge(projectStructureSnapshotOptionsSchema)
	.strict();
export type GetProjectStructureSnapshotInput = z.output<
	typeof getProjectStructureSnapshotInputSchema
>;

export const projectExplorationCatalogInputSchema =
	projectPathInputSchema.extend({
		focus: z
			.object({
				paths: z.array(z.string().trim().min(1).max(1024)).max(10).optional(),
				modules: z.array(z.string().trim().min(1).max(256)).max(5).optional(),
				terms: z.array(z.string().trim().min(2).max(80)).max(10).optional(),
			})
			.strict()
			.optional(),
		limits: z
			.object({
				files: z.number().int().min(1).max(20).optional(),
				tests: z.number().int().min(0).max(10).optional(),
				verificationCommands: z.number().int().min(0).max(6).optional(),
			})
			.strict()
			.optional(),
	});
export type ProjectExplorationCatalogInput = z.output<
	typeof projectExplorationCatalogInputSchema
>;

export const staticIntelligenceMcpToolFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
		reasonCode: projectExplorationCatalogFailureReasonSchema.optional(),
	})
	.strict();
export type StaticIntelligenceMcpToolFailure = z.infer<
	typeof staticIntelligenceMcpToolFailureSchema
>;

export const staticIntelligenceKnowledgeSourceListResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		version: z.literal("v1"),
		generatedAt: z.string(),
		sources: z.array(
			z
				.object({
					sourceId: z.string().min(1),
					projectId: z.string().min(1),
					rootRef: z.string().regex(/^[a-f0-9]{64}$/),
					projectName: z.string(),
					scanRunId: z.string().min(1),
					generationId: z.string().min(1),
					generationGeneratedAt: z.string(),
					sourceRevision: z
						.object({
							kind: z.enum(["git", "tree_hash_only"]),
							head: z.string().min(1).optional(),
							dirtyHash: z
								.string()
								.regex(/^[a-f0-9]{64}$/)
								.optional(),
							value: z.string().min(1),
						})
						.strict(),
					readiness: z.enum(["available", "stale", "degraded"]),
					scanProfile: z.string(),
					scanStatus: z.string(),
					findingCount: z.number().int().nonnegative(),
					reviewStatus: z.enum(["completed", "failed", "missing"]),
					riskBand: staticIntelligenceRiskBandSchema,
					evidenceQuality: staticIntelligenceEvidenceQualitySchema,
					contentHash: z.string().regex(/^[a-f0-9]{64}$/),
					exportHash: z.string().regex(/^[a-f0-9]{64}$/),
					generatedAt: z.string(),
					command: z.array(z.string()),
				})
				.strict(),
		),
		degradedReasons: z.array(z.string()),
	})
	.strict();
export type StaticIntelligenceKnowledgeSourceListResult = z.infer<
	typeof staticIntelligenceKnowledgeSourceListResultSchema
>;
