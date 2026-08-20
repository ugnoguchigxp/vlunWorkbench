import { z } from "zod";
import { sha256DigestSchema } from "./security-capability.schema";

export const scanExecutionStrictnessSchema = z.enum(["strict", "best_effort"]);
export const scanExecutionStepSchema = z.object({
	stepId: z.string().min(1).max(160),
	kind: z.enum([
		"static_tool",
		"dast",
		"runtime_scanner",
		"sbom_export",
		"api_schema_scan",
		"container_image_scan",
	]),
	adapter: z.string().min(1).max(100),
	required: z.boolean(),
	applicability: z.enum(["applicable", "not_applicable", "unknown"]),
	readiness: z.enum(["ready", "blocked", "unchecked"]),
	requirement: z.enum(["required_if_applicable", "advisory", "inventory"]),
	reasonCodes: z.array(z.string().min(1).max(100)).max(32),
	evidenceRefs: z.array(z.string().min(1).max(200)).max(32),
});

export const scanExecutionPlanSchema = z.object({
	schemaVersion: z.literal(1),
	scanRunId: z.string().uuid(),
	projectId: z.string().uuid(),
	profileId: z.string().min(1).max(160),
	strictness: scanExecutionStrictnessSchema,
	preflightBindingHash: sha256DigestSchema,
	preflightHash: sha256DigestSchema,
	planHash: sha256DigestSchema,
	qualificationHash: sha256DigestSchema.nullable(),
	steps: z.array(scanExecutionStepSchema).min(1).max(64),
});

export type ScanExecutionPlan = z.infer<typeof scanExecutionPlanSchema>;
