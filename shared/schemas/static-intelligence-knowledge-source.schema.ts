import { z } from "zod";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceRiskBandSchema,
} from "./static-intelligence.schema";
import { staticIntelligenceReadinessSchema } from "./static-intelligence-module.schema";

export const staticIntelligenceKnowledgeSourceBundleKindSchema = z.enum([
	"static_intelligence_export",
	"project_structure_snapshot",
	"agent_query",
	"evidence_bundle",
	"verification_commands",
	"guardrail_material",
]);
export type StaticIntelligenceKnowledgeSourceBundleKind = z.infer<
	typeof staticIntelligenceKnowledgeSourceBundleKindSchema
>;

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const staticIntelligenceKnowledgeSourceManifestSchema = z
	.object({
		version: z.literal("v1"),
		generatedAt: z.string(),
		source: z
			.object({
				kind: z.literal("vulnWorkbench.static_intelligence"),
				sourceId: z.string().min(1),
				projectId: z.string().min(1),
				scanRunId: z.string().min(1),
				exportHash: sha256HexSchema,
				contentHash: sha256HexSchema,
				schemaVersion: z.literal("static-intelligence-export-v1"),
			})
			.strict(),
		project: z
			.object({
				id: z.string().min(1),
				name: z.string(),
			})
			.strict(),
		scan: z
			.object({
				id: z.string().min(1),
				profile: z.string(),
				status: z.string(),
				findingCount: z.number().int().nonnegative(),
				reviewStatus: z.enum(["completed", "failed", "missing"]),
			})
			.strict(),
		risk: z
			.object({
				band: staticIntelligenceRiskBandSchema,
				evidenceQuality: staticIntelligenceEvidenceQualitySchema,
				degradedReasons: z.array(z.string()),
			})
			.strict(),
		redaction: z
			.object({
				status: z.literal("redacted"),
				rawArtifactBodyIncluded: z.literal(false),
				rawEvidenceSnippetIncluded: z.literal(false),
				rawSecretIncluded: z.literal(false),
			})
			.strict(),
		availableBundles: z.array(
			z
				.object({
					kind: staticIntelligenceKnowledgeSourceBundleKindSchema,
					command: z.array(z.string()),
					description: z.string(),
					requires: z
						.object({
							findingId: z.boolean().optional(),
							projectPath: z.boolean().optional(),
							query: z.boolean().optional(),
						})
						.strict()
						.optional(),
				})
				.strict(),
		),
		generation: z
			.object({
				generationId: z.string().min(1),
				generatedAt: z.string(),
				sourceTreeHash: sha256HexSchema,
				sourceStateHash: sha256HexSchema,
				snapshotRef: z.string().min(1),
				exportHash: sha256HexSchema,
				status: z.enum(["available", "degraded", "stale"]),
			})
			.strict()
			.optional(),
		readiness: staticIntelligenceReadinessSchema.optional(),
	})
	.strict();
export type StaticIntelligenceKnowledgeSourceManifest = z.infer<
	typeof staticIntelligenceKnowledgeSourceManifestSchema
>;

export const staticIntelligenceKnowledgeSourceManifestResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		version: z.literal("v1"),
		generatedAt: z.string(),
		manifest: staticIntelligenceKnowledgeSourceManifestSchema,
	})
	.strict();
export type StaticIntelligenceKnowledgeSourceManifestResult = z.infer<
	typeof staticIntelligenceKnowledgeSourceManifestResultSchema
>;

export const staticIntelligenceKnowledgeSourceManifestFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
	})
	.strict();
export type StaticIntelligenceKnowledgeSourceManifestFailure = z.infer<
	typeof staticIntelligenceKnowledgeSourceManifestFailureSchema
>;
