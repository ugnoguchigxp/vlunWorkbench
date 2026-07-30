import { z } from "zod";
import { scanReviewOutputSchema } from "./scan.schema";

export const diagnosticCriticalitySchema = z.enum([
	"critical",
	"high",
	"medium",
	"low",
	"informational",
	"unknown",
]);
export type DiagnosticCriticality = z.infer<typeof diagnosticCriticalitySchema>;

export const diagnosticFalsePositiveLikelihoodSchema = z.enum([
	"very_low",
	"low",
	"medium",
	"high",
	"very_high",
	"unknown",
]);
export type DiagnosticFalsePositiveLikelihood = z.infer<
	typeof diagnosticFalsePositiveLikelihoodSchema
>;

export const diagnosticExploitabilitySchema = z.enum([
	"demonstrated",
	"likely",
	"possible",
	"unlikely",
	"unknown",
]);
export type DiagnosticExploitability = z.infer<
	typeof diagnosticExploitabilitySchema
>;

export const diagnosticEvidenceRefSchema = z.object({
	kind: z.enum(["finding", "evidence", "artifact", "verification"]),
	id: z.string().min(1).max(200),
});
export type DiagnosticEvidenceRef = z.infer<typeof diagnosticEvidenceRefSchema>;

export const diagnosticFindingAssessmentSchema = z.object({
	findingId: z.string().uuid(),
	criticality: diagnosticCriticalitySchema,
	criticalityRationale: z.string().min(1).max(2000),
	falsePositiveLikelihood: diagnosticFalsePositiveLikelihoodSchema,
	exploitability: diagnosticExploitabilitySchema,
	businessImpact: z.string().min(1).max(2000),
	priority: z.enum(["critical", "high", "medium", "low", "info"]),
	remediation: z.string().min(1).max(3000),
	evidenceRefs: z.array(diagnosticEvidenceRefSchema).min(1).max(50),
	assumptions: z.array(z.string().min(1).max(1000)).max(20),
	unknowns: z.array(z.string().min(1).max(1000)).max(20),
});
export type DiagnosticFindingAssessment = z.infer<
	typeof diagnosticFindingAssessmentSchema
>;

export const automatedScanReviewOutputSchema = scanReviewOutputSchema.extend({
	findingAssessments: z.array(diagnosticFindingAssessmentSchema).max(50),
	systemicRiskThemes: z.array(z.string().min(1).max(1000)).max(20),
	limitations: z.array(z.string().min(1).max(1000)).max(20),
});
export type AutomatedScanReviewOutput = z.infer<
	typeof automatedScanReviewOutputSchema
>;

export const automatedDiagnosticStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"completed_with_limitations",
	"failed",
]);
export type AutomatedDiagnosticStatus = z.infer<
	typeof automatedDiagnosticStatusSchema
>;

export const automatedDiagnosticReadinessSchema = z.enum([
	"ready",
	"ready_with_limitations",
	"failed",
]);
export type AutomatedDiagnosticReadiness = z.infer<
	typeof automatedDiagnosticReadinessSchema
>;

export const automatedDiagnosticRunSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	inputSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
	scannerProvenanceHash: z.string().regex(/^[a-f0-9]{64}$/),
	pipelineVersion: z.string().min(1).max(100),
	status: automatedDiagnosticStatusSchema,
	readiness: automatedDiagnosticReadinessSchema.nullable(),
	scanReviewId: z.string().uuid().nullable(),
	scanReportId: z.string().uuid().nullable(),
	limitationCodes: z.array(z.string().min(1).max(100)),
	errorMessage: z.string().nullable(),
	attemptCount: z.number().int().nonnegative(),
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type AutomatedDiagnosticRun = z.infer<
	typeof automatedDiagnosticRunSchema
>;
