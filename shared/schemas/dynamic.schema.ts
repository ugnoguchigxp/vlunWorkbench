import { z } from "zod";

export const MAX_DYNAMIC_TIMEOUT_SEC = 300;
const MIN_DYNAMIC_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_DYNAMIC_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;

function parseDockerMemoryBytes(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)([kmgt])(?:i?b)?$/i);
	if (!match) return null;
	const amount = Number(match[1]);
	const power = { k: 1, m: 2, g: 3, t: 4 }[
		match[2]?.toLowerCase() as "k" | "m" | "g" | "t"
	];
	const bytes = amount * 1024 ** power;
	return Number.isFinite(bytes) ? bytes : null;
}

export const dynamicMemoryLimitSchema = z.string().superRefine((value, ctx) => {
	const bytes = parseDockerMemoryBytes(value);
	if (
		bytes === null ||
		bytes < MIN_DYNAMIC_MEMORY_BYTES ||
		bytes > MAX_DYNAMIC_MEMORY_BYTES
	) {
		ctx.addIssue({
			code: "custom",
			message: "memory must be between 512 MiB and 8 GiB.",
		});
	}
});

export const dynamicCpuLimitSchema = z.string().superRefine((value, ctx) => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0.25 || parsed > 4) {
		ctx.addIssue({
			code: "custom",
			message: "cpus must be between 0.25 and 4.",
		});
	}
});

export const dynamicKindSchema = z.enum(["test", "sanitizer", "fuzz"]);
export type DynamicKind = z.infer<typeof dynamicKindSchema>;

export const dynamicRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"timed_out",
	"cancelled",
]);
export type DynamicRunStatus = z.infer<typeof dynamicRunStatusSchema>;

export const dynamicOutcomeSchema = z.enum([
	"passed",
	"failed",
	"crashed",
	"timed_out",
	"inconclusive",
	"error",
]);
export type DynamicOutcome = z.infer<typeof dynamicOutcomeSchema>;

export const dynamicProfileConfigSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	profileId: z.string().min(1),
	dynamicKind: dynamicKindSchema,
	displayName: z.string().min(1),
	enabled: z.boolean(),
	commandJson: z.array(z.string()),
	workingDirectory: z.string(),
	timeoutSec: z.number().int().positive(),
	network: z.string(),
	memory: dynamicMemoryLimitSchema.nullable(),
	cpus: dynamicCpuLimitSchema.nullable(),
	writableWorkdir: z.boolean(),
	allowProjectScripts: z.boolean(),
	expectedArtifactsJson: z.array(z.string()),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdByUserId: z.string().uuid().nullable(),
	createdAt: z.string().or(z.date()),
	updatedAt: z.string().or(z.date()),
});
export type DynamicProfileConfig = z.infer<typeof dynamicProfileConfigSchema>;

export const dynamicRunSchema = z.object({
	id: z.string().uuid(),
	projectId: z.string().uuid(),
	scanRunId: z.string().uuid().nullable(),
	findingId: z.string().uuid().nullable(),
	profileConfigId: z.string().uuid(),
	profileId: z.string().min(1),
	dynamicKind: dynamicKindSchema,
	status: dynamicRunStatusSchema,
	outcome: dynamicOutcomeSchema.nullable(),
	runner: z.string(),
	commandJson: z.array(z.string()),
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
export type DynamicRun = z.infer<typeof dynamicRunSchema>;

export const dynamicArtifactKindSchema = z.enum([
	"stdout",
	"stderr",
	"log",
	"crash",
	"summary",
	"coverage",
	"raw_result",
]);
export type DynamicArtifactKind = z.infer<typeof dynamicArtifactKindSchema>;

export const dynamicArtifactSchema = z.object({
	id: z.string().uuid(),
	dynamicRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	findingId: z.string().uuid().nullable(),
	kind: dynamicArtifactKindSchema,
	format: z.string(),
	path: z.string(),
	sha256: z.string(),
	sizeBytes: z.number(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type DynamicArtifact = z.infer<typeof dynamicArtifactSchema>;

export const dynamicEvidenceKindSchema = z.enum([
	"dynamic-test-log",
	"sanitizer-finding",
	"fuzz-crash",
	"dynamic-result",
]);
export type DynamicEvidenceKind = z.infer<typeof dynamicEvidenceKindSchema>;

export const dynamicEvidenceSchema = z.object({
	id: z.string().uuid(),
	dynamicRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	findingId: z.string().uuid().nullable(),
	kind: dynamicEvidenceKindSchema,
	title: z.string(),
	artifactId: z.string().uuid().nullable(),
	location: z.record(z.string(), z.unknown()).nullable(),
	snippet: z.string().nullable(),
	metadata: z.record(z.string(), z.unknown()).default({}),
	createdAt: z.string().or(z.date()),
});
export type DynamicEvidence = z.infer<typeof dynamicEvidenceSchema>;

export const runDynamicRequestSchema = z.object({
	profileId: z.string().min(1),
	runner: z.enum(["docker"]).default("docker"),
	dockerImage: z.string().optional(),
	network: z.enum(["none", "default"]).optional(),
	timeoutSec: z
		.number()
		.int()
		.positive()
		.max(MAX_DYNAMIC_TIMEOUT_SEC)
		.optional(),
	memory: dynamicMemoryLimitSchema.optional(),
	cpus: dynamicCpuLimitSchema.optional(),
});
export type RunDynamicRequestInput = z.infer<typeof runDynamicRequestSchema>;

export const saveDynamicProfileRequestSchema = z.object({
	profileId: z.string().min(1),
	dynamicKind: dynamicKindSchema,
	displayName: z.string().min(1),
	enabled: z.boolean().optional().default(true),
	commandJson: z.array(z.string()).min(1),
	workingDirectory: z.string().optional().default(""),
	timeoutSec: z
		.number()
		.int()
		.positive()
		.max(MAX_DYNAMIC_TIMEOUT_SEC)
		.optional()
		.default(120),
	network: z.enum(["none", "default"]).optional().default("none"),
	memory: dynamicMemoryLimitSchema.nullable().optional(),
	cpus: dynamicCpuLimitSchema.nullable().optional(),
	writableWorkdir: z.boolean().optional().default(false),
	allowProjectScripts: z.boolean().optional().default(false),
	expectedArtifactsJson: z.array(z.string()).optional().default([]),
});
export type SaveDynamicProfileRequestInput = z.infer<
	typeof saveDynamicProfileRequestSchema
>;
