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
