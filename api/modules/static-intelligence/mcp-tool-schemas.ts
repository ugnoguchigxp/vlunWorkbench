import { z } from "zod";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceRiskBandSchema,
} from "../../../shared/schemas/static-intelligence.schema";
import { staticIntelligenceGuardrailMaterialTypeSchema } from "../../../shared/schemas/static-intelligence-guardrail-material.schema";

export const listKnowledgeSourcesInputSchema = z
	.object({
		projectId: z.string().trim().min(1).optional(),
		limit: z.number().int().min(1).max(100).optional(),
	})
	.strict();
export type ListKnowledgeSourcesInput = z.output<
	typeof listKnowledgeSourcesInputSchema
>;

export const getKnowledgeSourceManifestInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
	})
	.strict();
export type GetKnowledgeSourceManifestInput = z.output<
	typeof getKnowledgeSourceManifestInputSchema
>;

export const getGuardrailMaterialInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		type: staticIntelligenceGuardrailMaterialTypeSchema.optional(),
		includeMarkdown: z.boolean().optional(),
	})
	.strict();
export type GetGuardrailMaterialInput = z.output<
	typeof getGuardrailMaterialInputSchema
>;

export const getEvidenceBundleInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		findingId: z.string().trim().min(1),
	})
	.strict();
export type GetEvidenceBundleInput = z.output<
	typeof getEvidenceBundleInputSchema
>;

export const getVerificationCommandsInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		findingId: z.string().trim().min(1).optional(),
	})
	.strict();
export type GetVerificationCommandsInput = z.output<
	typeof getVerificationCommandsInputSchema
>;

export const getCodeStructureSnapshotInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1),
		maxFiles: z.number().int().min(1).max(20000).optional(),
	})
	.strict();
export type GetCodeStructureSnapshotInput = z.output<
	typeof getCodeStructureSnapshotInputSchema
>;

export const staticIntelligenceMcpToolFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
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
					projectName: z.string(),
					scanRunId: z.string().min(1),
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
