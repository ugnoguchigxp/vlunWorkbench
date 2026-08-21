import { z } from "zod";
import {
	scanCapabilityApplicabilitySchema,
	scanCapabilityExecutionSchema,
} from "./scan-capability.schema";
import { scanReasonCodeSchema } from "./scan-reason-code.schema";

export const normalizedProfileStepResultSchema = z.object({
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
	execution: scanCapabilityExecutionSchema,
	applicability: scanCapabilityApplicabilitySchema,
	coverageEffect: z.enum(["covered", "partial", "gap"]),
	reasonCodes: z.array(scanReasonCodeSchema).max(32),
	findingCount: z.number().int().nonnegative(),
	evidenceRefs: z.array(z.string().min(1).max(200)).max(64),
	artifactIds: z.array(z.string().min(1).max(200)).max(64),
	childRunRefs: z.array(z.string().min(1).max(200)).max(32),
	cleanupState: z.enum(["not_required", "completed", "failed", "quarantined"]),
});

export type NormalizedProfileStepResult = z.infer<
	typeof normalizedProfileStepResultSchema
>;
