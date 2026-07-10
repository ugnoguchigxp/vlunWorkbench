import { z } from "zod";
import { codeStructureFileTagSchema } from "./static-intelligence-code-structure.schema";
import {
	staticIntelligenceEvidenceQualitySchema,
	staticIntelligenceSeveritySchema,
} from "./static-intelligence.schema";

export const intelligenceReadinessStatusSchema = z.enum([
	"available",
	"stale",
	"degraded",
	"missing",
	"failed",
]);
export type IntelligenceReadinessStatus = z.infer<
	typeof intelligenceReadinessStatusSchema
>;

export const intelligenceCapabilityReadinessSchema = z
	.object({
		status: intelligenceReadinessStatusSchema,
		reasonCodes: z.array(z.string()),
		generatedAt: z.string().optional(),
		generationId: z.string().optional(),
		sourceRef: z.string().optional(),
	})
	.strict();
export type IntelligenceCapabilityReadiness = z.infer<
	typeof intelligenceCapabilityReadinessSchema
>;

export const staticIntelligenceReadinessSchema = z
	.object({
		export: intelligenceCapabilityReadinessSchema,
		fileRiskIndex: intelligenceCapabilityReadinessSchema,
		evidenceGraph: intelligenceCapabilityReadinessSchema,
		codeStructure: intelligenceCapabilityReadinessSchema,
		semanticIndex: intelligenceCapabilityReadinessSchema,
		agentBundle: intelligenceCapabilityReadinessSchema,
		ontologyHandoff: intelligenceCapabilityReadinessSchema,
	})
	.strict();
export type StaticIntelligenceReadiness = z.infer<
	typeof staticIntelligenceReadinessSchema
>;

export const staticIntelligenceModuleCandidateSchema = z
	.object({
		id: z.string().min(1),
		pathPrefix: z.string().min(1),
		label: z.string().min(1),
		fileCount: z.number().int().nonnegative(),
		entrypointFiles: z.array(z.string()),
		roleTags: z.array(codeStructureFileTagSchema),
		exportedSymbols: z.array(z.string()),
		internalDependencies: z.array(z.string()),
		packageDependencies: z.array(z.string()),
		risk: z
			.object({
				findingCount: z.number().int().nonnegative(),
				maxSeverity: staticIntelligenceSeveritySchema,
				evidenceQuality: staticIntelligenceEvidenceQualitySchema,
				fileRefs: z.array(z.string()),
				findingIds: z.array(z.string()),
			})
			.strict(),
		confidence: z.number().min(0).max(1),
		reasons: z.array(z.string()).min(1),
	})
	.strict();
export type StaticIntelligenceModuleCandidate = z.infer<
	typeof staticIntelligenceModuleCandidateSchema
>;

export const staticIntelligenceOntologyHandoffSchema = z
	.object({
		status: intelligenceReadinessStatusSchema,
		projectId: z.string().min(1),
		scanRunId: z.string().min(1),
		generationId: z.string().min(1),
		snapshotRef: z.string().min(1),
		exportHash: z.string().min(1),
		sourceTreeHash: z.string().min(1),
		modules: z.array(staticIntelligenceModuleCandidateSchema),
		graphSummary: z
			.object({
				nodeCounts: z.record(z.string(), z.number().int().nonnegative()),
				edgeCounts: z.record(z.string(), z.number().int().nonnegative()),
			})
			.strict(),
		verificationCommands: z.array(z.string()),
		sourceRefs: z.array(z.string()),
		degradedReasons: z.array(z.string()),
		consumerBoundary: z
			.object({
				ownsCanonicalOntology: z.literal(false),
				ownsTaskCompilation: z.literal(false),
				consumer: z.literal("NightWorkers"),
			})
			.strict(),
	})
	.strict();
export type StaticIntelligenceOntologyHandoff = z.infer<
	typeof staticIntelligenceOntologyHandoffSchema
>;
