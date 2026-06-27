import { z } from "zod";

// --- Project ---
export const projectSchema = z.object({
	id: z.string().uuid(),
	ownerUserId: z.string().uuid(),
	name: z.string().min(1),
	repoPath: z.string().min(1),
	defaultBranch: z.string().default("main"),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectSchema = z.object({
	name: z.string().min(1),
	repoPath: z.string().min(1),
	defaultBranch: z.string().default("main").optional(),
	metadata: z.record(z.string(), z.unknown()).default({}).optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

// --- Scan Run ---
export const scanRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
]);
export type ScanRunStatus = z.infer<typeof scanRunStatusSchema>;

export const scanRunSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	profile: z.string().default("baseline"),
	status: scanRunStatusSchema,
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	createdByUserId: z.string().uuid().nullable(),
	summary: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type ScanRun = z.infer<typeof scanRunSchema>;

// --- Scan Event ---
export const scanEventLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type ScanEventLevel = z.infer<typeof scanEventLevelSchema>;

export const scanEventSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	level: scanEventLevelSchema,
	eventType: z.string(),
	message: z.string(),
	data: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type ScanEvent = z.infer<typeof scanEventSchema>;

// --- Tool Run ---
export const toolRunSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	toolName: z.string(),
	toolVersion: z.string().nullable(),
	command: z.string().nullable(),
	status: z.string(),
	exitCode: z.number().nullable(),
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type ToolRun = z.infer<typeof toolRunSchema>;

// --- Scan Artifact ---
export const scanArtifactKindSchema = z.enum([
	"raw_result",
	"stdout",
	"stderr",
	"log",
	"normalized_result",
	"source_snippet",
	"report",
]);
export type ScanArtifactKind = z.infer<typeof scanArtifactKindSchema>;

export const scanArtifactSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	toolRunId: z.string().uuid().nullable(),
	kind: scanArtifactKindSchema,
	format: z.string(),
	path: z.string(),
	sha256: z.string(),
	sizeBytes: z.number(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type ScanArtifact = z.infer<typeof scanArtifactSchema>;

// --- Finding ---
export const findingSeveritySchema = z.enum([
	"info",
	"low",
	"medium",
	"high",
	"critical",
	"unknown",
]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingConfidenceSchema = z.enum(["static"]);
export type FindingConfidence = z.infer<typeof findingConfidenceSchema>;

export const findingStatusSchema = z.enum(["open"]);
export type FindingStatus = z.infer<typeof findingStatusSchema>;

export const findingSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	sourceTool: z.string(),
	ruleId: z.string(),
	title: z.string(),
	description: z.string(),
	severity: findingSeveritySchema,
	confidence: findingConfidenceSchema,
	status: findingStatusSchema,
	primaryLocation: z.record(z.string(), z.unknown()).nullable(),
	fingerprint: z.string(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type Finding = z.infer<typeof findingSchema>;

// --- Finding Evidence ---
export const findingEvidenceKindSchema = z.enum([
	"tool-output",
	"source-location",
	"scan-log",
]);
export type FindingEvidenceKind = z.infer<typeof findingEvidenceKindSchema>;

export const findingEvidenceSchema = z.object({
	id: z.string().uuid(),
	findingId: z.string().uuid(),
	kind: findingEvidenceKindSchema,
	title: z.string(),
	artifactId: z.string().uuid().nullable(),
	location: z.record(z.string(), z.unknown()).nullable(),
	snippet: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type FindingEvidence = z.infer<typeof findingEvidenceSchema>;

// --- Finding Review ---
export const falsePositiveLevelSchema = z.enum([
	"low",
	"medium",
	"high",
	"unknown",
]);
export const evidenceStrengthLevelSchema = z.enum([
	"weak",
	"moderate",
	"strong",
	"unknown",
]);
export const confidenceAdjustmentSchema = z.enum([
	"unchanged",
	"increase",
	"decrease",
	"unknown",
]);

export const findingReviewOutputSchema = z.object({
	summary: z.string().min(1).max(2000),
	likelyImpact: z.string().min(1).max(2000),
	falsePositiveAssessment: z.object({
		level: falsePositiveLevelSchema,
		reasoning: z.string().min(1).max(2000),
	}),
	evidenceStrength: z.object({
		level: evidenceStrengthLevelSchema,
		reasoning: z.string().min(1).max(2000),
	}),
	remediationDirection: z.string().min(1).max(2000),
	reviewerNotes: z.array(z.string().min(1).max(1000)).max(10),
	confidenceAdjustment: confidenceAdjustmentSchema,
});
export type FindingReviewOutput = z.infer<typeof findingReviewOutputSchema>;

export const findingReviewSchema = z.object({
	id: z.string().uuid(),
	findingId: z.string().uuid(),
	provider: z.string(),
	model: z.string(),
	status: z.enum(["running", "completed", "failed"]),
	summary: z.string().nullable(),
	likelyImpact: z.string().nullable(),
	falsePositiveAssessment: z
		.object({
			level: falsePositiveLevelSchema,
			reasoning: z.string(),
		})
		.nullable(),
	evidenceStrength: z
		.object({
			level: evidenceStrengthLevelSchema,
			reasoning: z.string(),
		})
		.nullable(),
	remediationDirection: z.string().nullable(),
	reviewerNotes: z.array(z.string()).nullable(),
	confidenceAdjustment: confidenceAdjustmentSchema,
	inputBundle: z.record(z.string(), z.unknown()).nullable(),
	output: findingReviewOutputSchema.nullable(),
	errorMessage: z.string().nullable(),
	createdByUserId: z.string().uuid().nullable(),
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type FindingReview = z.infer<typeof findingReviewSchema>;

// --- Finding Decision ---
export const reviewerDecisionStateSchema = z.enum([
	"accepted",
	"false_positive",
	"deferred",
	"needs_fix",
]);
export type ReviewerDecisionState = z.infer<typeof reviewerDecisionStateSchema>;

export const reviewerDecisionReasonSchema = z.enum([
	"confirmed_by_evidence",
	"confirmed_by_review",
	"insufficient_evidence",
	"environment_specific",
	"tool_noise",
	"not_exploitable",
	"accepted_risk",
	"other",
]);
export type ReviewerDecisionReason = z.infer<
	typeof reviewerDecisionReasonSchema
>;

export const findingDecisionSchema = z.object({
	id: z.string().uuid(),
	findingId: z.string().uuid(),
	decision: reviewerDecisionStateSchema,
	reason: reviewerDecisionReasonSchema,
	comment: z.string().nullable(),
	linkedReviewId: z.string().uuid().nullable(),
	decidedByUserId: z.string().uuid().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type FindingDecision = z.infer<typeof findingDecisionSchema>;

export const createFindingDecisionSchema = z.object({
	decision: reviewerDecisionStateSchema,
	reason: reviewerDecisionReasonSchema,
	comment: z.string().optional(),
	linkedReviewId: z.string().uuid().optional(),
	metadata: z.record(z.string(), z.unknown()).default({}).optional(),
});
export type CreateFindingDecisionInput = z.infer<
	typeof createFindingDecisionSchema
>;

// --- Scan Review ---
export const scanImprovementRequestSchema = z.object({
	title: z.string().min(1).max(200),
	objective: z.string().min(1).max(2000),
	scope: z.array(z.string().min(1).max(1000)).max(20),
	priorityPlan: z
		.array(
			z.object({
				priority: z.enum(["critical", "high", "medium", "low"]),
				rationale: z.string().min(1).max(1000),
				findingIds: z.array(z.string().uuid()).max(50),
			}),
		)
		.max(20),
	implementationTasks: z
		.array(
			z.object({
				title: z.string().min(1).max(200),
				body: z.string().min(1).max(2000),
				findingIds: z.array(z.string().uuid()).max(50),
				evidenceRefs: z.array(z.string().min(1).max(200)).max(50),
			}),
		)
		.max(30),
	acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(20),
	verificationCommands: z.array(z.string().min(1).max(500)).max(20),
	constraints: z.array(z.string().min(1).max(1000)).max(20),
	nonGoals: z.array(z.string().min(1).max(1000)).max(20),
	handoffPrompt: z.string().min(1).max(6000),
});
export type ScanImprovementRequest = z.infer<
	typeof scanImprovementRequestSchema
>;

export const scanReviewOutputSchema = z.object({
	summary: z.string().min(1).max(3000),
	riskOverview: z.string().min(1).max(3000),
	priorityNotes: z.array(z.string().min(1).max(1000)).max(20),
	coverageNotes: z.array(z.string().min(1).max(1000)).max(20),
	falsePositiveHotspots: z.array(z.string().min(1).max(1000)).max(20),
	recommendedNextActions: z.array(z.string().min(1).max(1000)).max(20),
	findingTriageHints: z
		.array(
			z.object({
				findingId: z.string().uuid(),
				note: z.string().min(1).max(1000),
				priority: z.enum(["critical", "high", "medium", "low", "info"]),
			}),
		)
		.max(50),
	confidenceNotes: z.array(z.string().min(1).max(1000)).max(20),
	improvementRequest: scanImprovementRequestSchema,
});
export type ScanReviewOutput = z.infer<typeof scanReviewOutputSchema>;

export const scanReviewSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	provider: z.string(),
	model: z.string(),
	status: z.enum(["running", "completed", "failed"]),
	summary: z.string().nullable(),
	riskOverview: z.string().nullable(),
	priorityNotes: z.array(z.string()),
	coverageNotes: z.array(z.string()),
	falsePositiveHotspots: z.array(z.string()),
	recommendedNextActions: z.array(z.string()),
	findingTriageHints: z.array(z.record(z.string(), z.unknown())),
	confidenceNotes: z.array(z.string()),
	inputBundle: z.record(z.string(), z.unknown()).default({}),
	output: z.record(z.string(), z.unknown()).default({}),
	errorMessage: z.string().nullable(),
	createdByUserId: z.string().uuid().nullable(),
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type ScanReview = z.infer<typeof scanReviewSchema>;

// --- Scan Report ---
export const scanReportSummaryModeSchema = z.enum([
	"deterministic",
	"deterministic_with_llm_summary",
]);
export type ScanReportSummaryMode = z.infer<typeof scanReportSummaryModeSchema>;

export const scanReportLlmSummaryOutputSchema = z.object({
	executiveSummary: z.string().min(1).max(3000),
	keyFindings: z.array(z.string().min(1).max(1000)).max(20),
	riskNarrative: z.string().min(1).max(3000),
	recommendedNextActions: z.array(z.string().min(1).max(1000)).max(20),
	confidenceNotes: z.array(z.string().min(1).max(1000)).max(20),
});
export type ScanReportLlmSummaryOutput = z.infer<
	typeof scanReportLlmSummaryOutputSchema
>;

export const scanReportSchema = z.object({
	id: z.string().uuid(),
	scanRunId: z.string().uuid(),
	artifactId: z.string().uuid().nullable(),
	format: z.string(),
	title: z.string(),
	summary: z.string().nullable(),
	options: z.object({
		includeFalsePositives: z.boolean(),
		includeDeferred: z.boolean(),
		includeUndecided: z.boolean(),
		summaryMode: scanReportSummaryModeSchema
			.optional()
			.default("deterministic"),
	}),
	status: z.enum(["running", "completed", "failed"]),
	errorMessage: z.string().nullable(),
	generatedByUserId: z.string().uuid().nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type ScanReport = z.infer<typeof scanReportSchema>;

export const createScanReportSchema = z.object({
	format: z.literal("markdown").default("markdown"),
	title: z.string().min(1).default("Security Report"),
	includeFalsePositives: z.boolean().default(true),
	includeDeferred: z.boolean().default(true),
	includeUndecided: z.boolean().default(true),
	summaryMode: scanReportSummaryModeSchema.default("deterministic"),
});
export type CreateScanReportInput = z.infer<typeof createScanReportSchema>;
