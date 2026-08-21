import { z } from "zod";

export const sourceSastCoverageSchema = z.object({
	capability: z.literal("source_sast"),
	applicability: z.enum(["applicable", "not_applicable", "unknown"]),
	state: z.enum(["applicable", "executed", "not_applicable", "unknown"]),
	coverageEffect: z.enum(["covered", "gap"]),
	stepId: z.literal("semgrep").nullable(),
	engine: z.literal("semgrep").nullable(),
	rulesetId: z.literal("curated-sast-v1").nullable(),
	limitationCodes: z.array(z.string().min(1).max(100)).max(20),
});

export type SourceSastCoverage = z.infer<typeof sourceSastCoverageSchema>;
