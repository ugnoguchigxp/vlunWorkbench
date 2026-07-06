import { z } from "zod";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceRiskBandSchema,
} from "./static-intelligence.schema";
import { riskCommunityConfidenceSchema } from "./static-intelligence-landscape.schema";

export const staticIntelligenceGuardrailMaterialTypeSchema = z.enum([
	"security_guardrail_material",
	"verification_recipe_material",
	"false_positive_lesson_material",
	"agent_actionability_lesson_material",
	"scanner_tuning_lesson_material",
]);
export type StaticIntelligenceGuardrailMaterialType = z.infer<
	typeof staticIntelligenceGuardrailMaterialTypeSchema
>;

export const staticIntelligenceGuardrailMaterialGeneratedFromSchema = z.enum([
	"finding",
	"file_risk",
	"risk_community",
	"security_landscape",
	"handoff",
	"scan_summary",
]);
export type StaticIntelligenceGuardrailMaterialGeneratedFrom = z.infer<
	typeof staticIntelligenceGuardrailMaterialGeneratedFromSchema
>;

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const staticIntelligenceGuardrailMaterialSchema = z
	.object({
		id: z.string().min(1),
		type: staticIntelligenceGuardrailMaterialTypeSchema,
		title: z.string().min(1),
		summary: z.string().min(1),
		candidateOnly: z.literal(true),
		source: z
			.object({
				kind: z.literal("vulnWorkbench.static_intelligence"),
				sourceId: z.string().min(1),
				scanRunId: z.string().min(1),
				sourceRefs: z.array(z.string().min(1)).min(1),
				contentHash: sha256HexSchema,
			})
			.strict(),
		applicability: z
			.object({
				domains: z.array(z.string()),
				technologies: z.array(z.string()),
				changeTypes: z.array(z.string()),
			})
			.strict(),
		refs: z
			.object({
				findingIds: z.array(z.string()),
				evidenceRefs: z.array(z.string()),
				artifactRefs: z.array(z.string()),
				fileRefs: z.array(z.string()),
				ruleIds: z.array(z.string()),
				scanners: z.array(z.string()),
			})
			.strict(),
		suggestedDistillation: z
			.object({
				contextStillType: z.enum(["rule", "procedure"]),
				polarity: z.enum(["positive", "negative", "neutral"]),
				avoid: z.string().optional(),
				prefer: z.string().optional(),
				procedureSections: z
					.object({
						useWhen: z.array(z.string()),
						workflow: z.array(z.string()),
						verification: z.array(z.string()),
						avoid: z.array(z.string()),
					})
					.strict()
					.optional(),
			})
			.strict(),
		metadata: z
			.object({
				confidence: riskCommunityConfidenceSchema,
				evidenceQuality: staticIntelligenceEvidenceQualitySchema,
				riskBand: staticIntelligenceRiskBandSchema,
				materialHash: sha256HexSchema,
				generatedFrom: z.array(
					staticIntelligenceGuardrailMaterialGeneratedFromSchema,
				),
				degradedReasons: z.array(z.string()),
			})
			.strict(),
	})
	.strict();
export type StaticIntelligenceGuardrailMaterial = z.infer<
	typeof staticIntelligenceGuardrailMaterialSchema
>;

export const staticIntelligenceGuardrailMaterialResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		version: z.literal("v1"),
		generatedAt: z.string(),
		scanRunId: z.string().min(1),
		sourceManifest: z
			.object({
				sourceId: z.string().min(1),
				contentHash: sha256HexSchema,
				exportHash: sha256HexSchema,
			})
			.strict(),
		filters: z
			.object({
				type: staticIntelligenceGuardrailMaterialTypeSchema.optional(),
				includeMarkdown: z.boolean(),
			})
			.strict(),
		materials: z.array(staticIntelligenceGuardrailMaterialSchema),
		markdown: z.string().optional(),
		degradedReasons: z.array(z.string()),
	})
	.strict();
export type StaticIntelligenceGuardrailMaterialResult = z.infer<
	typeof staticIntelligenceGuardrailMaterialResultSchema
>;

export const staticIntelligenceGuardrailMaterialFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
		degradedReasons: z.array(z.string()).optional(),
	})
	.strict();
export type StaticIntelligenceGuardrailMaterialFailure = z.infer<
	typeof staticIntelligenceGuardrailMaterialFailureSchema
>;

export const staticIntelligenceGuardrailMaterialCliTypeSchema =
	staticIntelligenceGuardrailMaterialTypeSchema;
