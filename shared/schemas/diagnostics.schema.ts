import { z } from "zod";

export const attackSurfaceCategorySchema = z.enum([
	"api_route",
	"auth_boundary",
	"artifact_access",
	"file_path_boundary",
	"execution_boundary",
	"external_call",
	"database_write",
	"configuration_boundary",
]);
export type AttackSurfaceCategory = z.infer<typeof attackSurfaceCategorySchema>;

export const attackSurfaceConfidenceSchema = z.enum(["high", "medium", "low"]);
export type AttackSurfaceConfidence = z.infer<
	typeof attackSurfaceConfidenceSchema
>;

export const securityCheckStatusSchema = z.enum([
	"pass",
	"fail",
	"warn",
	"not_applicable",
	"manual_review",
	"not_checked",
]);
export type SecurityCheckStatus = z.infer<typeof securityCheckStatusSchema>;

export const diagnosticReportKindSchema = z.enum(["zero-finding"]);
export type DiagnosticReportKind = z.infer<typeof diagnosticReportKindSchema>;

export const diagnosticReportStatusSchema = z.enum([
	"running",
	"completed",
	"failed",
]);
export type DiagnosticReportStatus = z.infer<
	typeof diagnosticReportStatusSchema
>;

export const evidenceRefSchema = z.object({
	kind: z.enum([
		"file",
		"route",
		"scan_artifact",
		"tool_run",
		"finding",
		"diagnostic",
	]),
	id: z.string().optional(),
	path: z.string().optional(),
	line: z.number().int().positive().optional(),
	label: z.string().optional(),
});
export type DiagnosticEvidenceRef = z.infer<typeof evidenceRefSchema>;

export const runAttackSurfaceInventoryRequestSchema = z.object({
	dryRun: z.boolean().optional(),
});

export const runSecurityChecksRequestSchema = z.object({
	category: z.string().optional(),
	checkId: z.string().optional(),
	dryRun: z.boolean().optional(),
});

export const createDiagnosticReportRequestSchema = z.object({
	kind: diagnosticReportKindSchema.default("zero-finding"),
});
