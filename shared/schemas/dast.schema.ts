import { z } from "zod";

export const dastKindSchema = z.enum(["http", "browser", "form"]);
export type DastKind = z.infer<typeof dastKindSchema>;

export const dastRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"timed_out",
	"cancelled",
]);
export type DastRunStatus = z.infer<typeof dastRunStatusSchema>;

export const dastOutcomeSchema = z.enum([
	"passed",
	"findings",
	"failed",
	"timed_out",
	"inconclusive",
	"error",
]);
export type DastOutcome = z.infer<typeof dastOutcomeSchema>;

const dateLikeSchema = z.string().or(z.date());
const jsonRecordSchema = z.record(z.string(), z.unknown()).default({});

export const dastTargetConfigSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	name: z.string().min(1),
	origin: z.string().min(1),
	normalizedOrigin: z.string().url(),
	enabled: z.boolean(),
	allowLoopback: z.boolean(),
	allowPrivateNetwork: z.boolean(),
	allowedPathsJson: z.array(z.string()),
	excludedPathsJson: z.array(z.string()),
	defaultHeadersJson: z.record(z.string(), z.string()),
	maxDepth: z.number().int().min(0),
	maxRequests: z.number().int().positive(),
	rateLimitPerSec: z.number().int().positive(),
	timeoutSec: z.number().int().positive(),
	metadata: jsonRecordSchema,
	createdByUserId: z.string().uuid().nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type DastTargetConfig = z.infer<typeof dastTargetConfigSchema>;

export const dastProfileConfigSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	targetConfigId: z.string().uuid(),
	profileId: z.string().min(1),
	displayName: z.string().min(1),
	enabled: z.boolean(),
	routePathsJson: z.array(z.string()),
	formSelectorsJson: z.array(z.string()),
	checkOptionsJson: jsonRecordSchema,
	timeoutSec: z.number().int().positive().nullable(),
	maxRequests: z.number().int().positive().nullable(),
	metadata: jsonRecordSchema,
	createdByUserId: z.string().uuid().nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type DastProfileConfig = z.infer<typeof dastProfileConfigSchema>;

export const dastRunSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid(),
	targetConfigId: z.string().uuid(),
	profileConfigId: z.string().uuid().nullable(),
	profileId: z.string().min(1),
	dastKind: dastKindSchema,
	targetOrigin: z.string().url(),
	runnerOrigin: z.string().url(),
	status: dastRunStatusSchema,
	outcome: dastOutcomeSchema.nullable(),
	startedAt: dateLikeSchema.nullable(),
	completedAt: dateLikeSchema.nullable(),
	summary: z.string().nullable(),
	errorMessage: z.string().nullable(),
	metadata: jsonRecordSchema,
	createdByUserId: z.string().uuid().nullable(),
	createdAt: dateLikeSchema,
	updatedAt: dateLikeSchema,
});
export type DastRun = z.infer<typeof dastRunSchema>;

export const dastArtifactKindSchema = z.enum([
	"raw_result",
	"http_log",
	"browser_console",
	"browser_network",
	"screenshot",
	"stdout",
	"stderr",
	"summary",
]);
export type DastArtifactKind = z.infer<typeof dastArtifactKindSchema>;

export const dastArtifactSchema = z.object({
	id: z.string().uuid(),
	dastRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid(),
	kind: dastArtifactKindSchema,
	format: z.enum(["json", "text", "png", "markdown"]),
	path: z.string(),
	sha256: z.string(),
	sizeBytes: z.number().int().min(0),
	metadata: jsonRecordSchema,
	createdAt: dateLikeSchema,
});
export type DastArtifact = z.infer<typeof dastArtifactSchema>;

export const dastEvidenceKindSchema = z.enum([
	"http-response",
	"http-header",
	"cookie-attribute",
	"cors-policy",
	"browser-console",
	"browser-network",
	"screenshot",
	"dast-result",
]);
export type DastEvidenceKind = z.infer<typeof dastEvidenceKindSchema>;

export const dastEvidenceSchema = z.object({
	id: z.string().uuid(),
	dastRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid(),
	findingId: z.string().uuid().nullable(),
	kind: dastEvidenceKindSchema,
	title: z.string().min(1),
	artifactId: z.string().uuid().nullable(),
	location: z.record(z.string(), z.unknown()).nullable(),
	snippet: z.string().nullable(),
	metadata: jsonRecordSchema,
	createdAt: dateLikeSchema,
});
export type DastEvidence = z.infer<typeof dastEvidenceSchema>;

const pathPrefixSchema = z.string().regex(/^\//, "Path must start with /");

export const saveDastTargetRequestSchema = z.object({
	name: z.string().min(1),
	origin: z.string().min(1),
	enabled: z.boolean().optional().default(true),
	allowLoopback: z.boolean().optional().default(true),
	allowPrivateNetwork: z.boolean().optional().default(false),
	allowedPathsJson: z.array(pathPrefixSchema).optional().default(["/"]),
	excludedPathsJson: z.array(pathPrefixSchema).optional().default([]),
	defaultHeadersJson: z.record(z.string(), z.string()).optional().default({}),
	maxDepth: z.number().int().min(0).max(3).optional().default(0),
	maxRequests: z.number().int().positive().max(100).optional().default(20),
	rateLimitPerSec: z.number().int().positive().max(10).optional().default(2),
	timeoutSec: z.number().int().positive().max(120).optional().default(120),
	metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type SaveDastTargetRequestInput = z.infer<
	typeof saveDastTargetRequestSchema
>;

export const saveDastProfileRequestSchema = z.object({
	targetConfigId: z.string().uuid(),
	profileId: z.string().min(1),
	displayName: z.string().min(1),
	enabled: z.boolean().optional().default(true),
	routePathsJson: z.array(pathPrefixSchema).optional().default([]),
	formSelectorsJson: z.array(z.string().min(1)).optional().default([]),
	checkOptionsJson: z.record(z.string(), z.unknown()).optional().default({}),
	timeoutSec: z.number().int().positive().max(120).nullable().optional(),
	maxRequests: z.number().int().positive().max(100).nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional().default({}),
});
export type SaveDastProfileRequestInput = z.infer<
	typeof saveDastProfileRequestSchema
>;

export const runDastRequestSchema = z
	.object({
		targetConfigId: z.string().uuid().optional(),
		autoTarget: z.boolean().optional().default(false),
		profileId: z.string().min(1),
		profileConfigId: z.string().uuid().optional(),
		scanRunId: z.string().uuid().optional(),
		runner: z.enum(["host", "docker", "mock"]).optional().default("host"),
		dockerImage: z.string().optional(),
		timeoutSec: z.number().int().positive().max(120).optional(),
		maxRequests: z.number().int().positive().max(100).optional(),
		dryRun: z.boolean().optional().default(false),
	})
	.superRefine((value, ctx) => {
		if (!value.autoTarget && !value.targetConfigId) {
			ctx.addIssue({
				code: "custom",
				path: ["targetConfigId"],
				message: "targetConfigId is required unless autoTarget is true",
			});
		}
	});
export type RunDastRequestInput = z.infer<typeof runDastRequestSchema>;
