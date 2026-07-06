import { z } from "zod";

export const staticIntelligenceSeveritySchema = z.enum([
	"info",
	"low",
	"medium",
	"high",
	"critical",
	"unknown",
]);
export type StaticIntelligenceSeverity = z.infer<
	typeof staticIntelligenceSeveritySchema
>;

export const staticIntelligenceRiskBandSchema = z.enum([
	"none",
	"low",
	"medium",
	"high",
	"critical",
	"unknown",
]);
export type StaticIntelligenceRiskBand = z.infer<
	typeof staticIntelligenceRiskBandSchema
>;

export const staticIntelligenceEvidenceQualitySchema = z.enum([
	"none",
	"weak",
	"mixed",
	"strong",
	"unknown",
]);
export type StaticIntelligenceEvidenceQuality = z.infer<
	typeof staticIntelligenceEvidenceQualitySchema
>;

export const fileRiskIndexEntrySchema = z.object({
	path: z.string(),
	findingCount: z.number().int().nonnegative(),
	maxSeverity: staticIntelligenceSeveritySchema,
	evidenceQuality: staticIntelligenceEvidenceQualitySchema,
	scanners: z.array(z.string()),
	ruleIds: z.array(z.string()),
	findingIds: z.array(z.string()),
	evidenceRefs: z.array(z.string()),
	artifactRefs: z.array(z.string()),
	verificationRefs: z.array(z.string()),
	latestScanRunId: z.string(),
	latestSeenAt: z.string().optional(),
});
export type FileRiskIndexEntry = z.infer<typeof fileRiskIndexEntrySchema>;

export const diagnosticEvidenceNodeKindSchema = z.enum([
	"project",
	"scan_run",
	"scanner",
	"finding",
	"evidence",
	"artifact",
	"file",
	"review",
	"verification",
]);
export type DiagnosticEvidenceNodeKind = z.infer<
	typeof diagnosticEvidenceNodeKindSchema
>;

export const diagnosticEvidenceEdgeKindSchema = z.enum([
	"has_scan",
	"detected_by",
	"evidenced_by",
	"located_in",
	"stored_as",
	"reviewed_by",
	"verified_by",
	"related_to",
]);
export type DiagnosticEvidenceEdgeKind = z.infer<
	typeof diagnosticEvidenceEdgeKindSchema
>;

export const diagnosticEvidenceNodeSchema = z.object({
	id: z.string(),
	kind: diagnosticEvidenceNodeKindSchema,
	label: z.string(),
	sourceId: z.string().optional(),
	severity: z.string().optional(),
	confidence: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DiagnosticEvidenceNode = z.infer<
	typeof diagnosticEvidenceNodeSchema
>;

export const diagnosticEvidenceEdgeSchema = z.object({
	id: z.string(),
	from: z.string(),
	to: z.string(),
	kind: diagnosticEvidenceEdgeKindSchema,
	confidence: z.number().min(0).max(1),
	evidenceRefs: z.array(z.string()),
});
export type DiagnosticEvidenceEdge = z.infer<
	typeof diagnosticEvidenceEdgeSchema
>;

export const diagnosticEvidenceGraphSchema = z.object({
	nodes: z.array(diagnosticEvidenceNodeSchema),
	edges: z.array(diagnosticEvidenceEdgeSchema),
});
export type DiagnosticEvidenceGraph = z.infer<
	typeof diagnosticEvidenceGraphSchema
>;

export const staticIntelligenceHandoffSchema = z.object({
	title: z.string(),
	objective: z.string(),
	acceptanceCriteria: z.array(z.string()),
	verificationCommands: z.array(z.string()),
	constraints: z.array(z.string()),
	nonGoals: z.array(z.string()),
});
export type StaticIntelligenceHandoff = z.infer<
	typeof staticIntelligenceHandoffSchema
>;

export const staticIntelligenceExportV1Schema = z.object({
	version: z.literal("v1"),
	generatedAt: z.string(),
	project: z.object({
		id: z.string(),
		name: z.string(),
		rootPath: z.string().optional(),
	}),
	scan: z.object({
		id: z.string(),
		profile: z.string(),
		status: z.string(),
		startedAt: z.string().nullable(),
		completedAt: z.string().nullable(),
		findingCount: z.number().int().nonnegative(),
		toolRunCount: z.number().int().nonnegative(),
		artifactCount: z.number().int().nonnegative(),
		reviewStatus: z.enum(["completed", "failed", "missing"]),
	}),
	scanSummary: z.object({
		riskBand: staticIntelligenceRiskBandSchema,
		evidenceQuality: staticIntelligenceEvidenceQualitySchema,
		degradedReasons: z.array(z.string()),
	}),
	fileRiskIndex: z.array(fileRiskIndexEntrySchema),
	graph: diagnosticEvidenceGraphSchema,
	handoff: staticIntelligenceHandoffSchema.optional(),
});
export type StaticIntelligenceExportV1 = z.infer<
	typeof staticIntelligenceExportV1Schema
>;
