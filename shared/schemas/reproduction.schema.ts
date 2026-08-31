import { z } from "zod";
import {
	evidenceStrengthSchema,
	scannerObservationOutcomeSchema,
	verificationKindSchema,
} from "./verification.schema";

export const MAX_REPRODUCTION_TIMEOUT_SEC = 900;

export const reproductionRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"timed_out",
	"cancelled",
]);
export type ReproductionRunStatus = z.infer<typeof reproductionRunStatusSchema>;

export const reproductionOutcomeSchema = z.enum([
	"reproduced",
	"not_reproduced",
	"inconclusive",
	"error",
]);
export type ReproductionOutcome = z.infer<typeof reproductionOutcomeSchema>;

export const reproductionRunSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid(),
	findingId: z.string().uuid(),
	profileId: z.string().min(1),
	status: reproductionRunStatusSchema,
	outcome: scannerObservationOutcomeSchema
		.or(reproductionOutcomeSchema)
		.nullable(),
	verificationKind: verificationKindSchema.default("scanner_recheck"),
	evidenceStrength: evidenceStrengthSchema.default("scanner_signal"),
	runner: z.string(),
	commandJson: z.array(z.string()).nullable(),
	exitCode: z.number().nullable(),
	startedAt: z.string().or(z.date()).nullable(),
	completedAt: z.string().or(z.date()).nullable(),
	summary: z.string().nullable(),
	errorMessage: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdByUserId: z.string().uuid().nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type ReproductionRun = z.infer<typeof reproductionRunSchema>;

export const reproductionArtifactKindSchema = z.enum([
	"raw_result",
	"stdout",
	"stderr",
	"log",
	"summary",
]);
export type ReproductionArtifactKind = z.infer<
	typeof reproductionArtifactKindSchema
>;

export const reproductionArtifactSchema = z.object({
	id: z.string().uuid(),
	reproductionRunId: z.string().uuid(),
	findingId: z.string().uuid(),
	kind: reproductionArtifactKindSchema,
	format: z.string(),
	path: z.string(),
	sha256: z.string(),
	sizeBytes: z.number(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type ReproductionArtifact = z.infer<typeof reproductionArtifactSchema>;

export const reproductionEvidenceKindSchema = z.enum([
	"reproduction-result",
	"reproduction-log",
	"tool-output",
]);
export type ReproductionEvidenceKind = z.infer<
	typeof reproductionEvidenceKindSchema
>;

export const reproductionEvidenceSchema = z.object({
	id: z.string().uuid(),
	reproductionRunId: z.string().uuid(),
	findingId: z.string().uuid(),
	kind: reproductionEvidenceKindSchema,
	title: z.string(),
	artifactId: z.string().uuid().nullable(),
	location: z.record(z.string(), z.unknown()).nullable(),
	snippet: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type ReproductionEvidence = z.infer<typeof reproductionEvidenceSchema>;

export const runReproductionRequestSchema = z.object({
	profileId: z.string().min(1),
	runner: z.enum(["docker"]).default("docker"),
	dockerImage: z.string().optional(),
	network: z.enum(["none", "default"]).optional(),
	timeoutSec: z
		.number()
		.int()
		.positive()
		.max(MAX_REPRODUCTION_TIMEOUT_SEC)
		.optional(),
	memory: z.string().optional(),
	cpus: z.string().optional(),
});
export type RunReproductionRequestInput = z.infer<
	typeof runReproductionRequestSchema
>;
