import { z } from "zod";
import { findingSeveritySchema } from "./scan.schema";

/** A versioned, read-time projection used only to group persisted raw findings. */
export const findingDedupeLocationSchema = z.object({
	kind: z.enum(["source", "url", "package", "resource", "unknown"]),
	path: z.string().nullable(),
	startLine: z.number().int().positive().nullable(),
	endLine: z.number().int().positive().nullable(),
	startCol: z.number().int().positive().nullable(),
	endCol: z.number().int().positive().nullable(),
	method: z.string().nullable(),
	parameter: z.string().nullable(),
	resource: z.string().nullable(),
});
export type FindingDedupeLocation = z.infer<typeof findingDedupeLocationSchema>;

export const findingIssueKindSchema = z.enum([
	"dependency",
	"secret",
	"source",
	"iac",
	"web",
	"api",
	"business_logic",
	"unknown",
]);
export type FindingIssueKind = z.infer<typeof findingIssueKindSchema>;

export const findingDedupeIdentitySchema = z.object({
	version: z.literal(1),
	issueKind: findingIssueKindSchema,
	assetKey: z.string().nullable(),
	location: findingDedupeLocationSchema,
	familyKeys: z.array(z.string()).max(50),
	advisoryIds: z.array(z.string()).max(50),
	packageKey: z.string().nullable(),
	anchor: z.string().nullable(),
	limitations: z.array(z.string()).max(20),
});
export type FindingDedupeIdentityV1 = z.infer<
	typeof findingDedupeIdentitySchema
>;

export const findingPairVerdictSchema = z.enum([
	"same",
	"different",
	"ambiguous",
]);
export const findingPairConfidenceSchema = z.enum([
	"exact",
	"high",
	"semantic_high",
	"none",
]);
export const findingGroupMatchConfidenceSchema = z.enum([
	"exact",
	"high",
	"semantic_high",
	"singleton",
]);

export const findingPairDecisionSchema = z.object({
	leftFindingId: z.string().uuid(),
	rightFindingId: z.string().uuid(),
	verdict: findingPairVerdictSchema,
	confidence: findingPairConfidenceSchema,
	method: z.enum(["deterministic", "semantic"]),
	reasonCodes: z.array(z.string()).max(20),
	comparisonHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type FindingPairDecision = z.infer<typeof findingPairDecisionSchema>;

export const builtFindingGroupSchema = z.object({
	stableKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	representativeFindingId: z.string().uuid(),
	memberFindingIds: z.array(z.string().uuid()).min(1),
	issueKind: findingIssueKindSchema,
	title: z.string(),
	description: z.string(),
	severity: findingSeveritySchema,
	primaryLocation: findingDedupeLocationSchema,
	sourceTools: z.array(z.string()),
	matchConfidence: findingGroupMatchConfidenceSchema,
	reasonCodes: z.array(z.string()),
});
export type BuiltFindingGroup = z.infer<typeof builtFindingGroupSchema>;

export const GROUPING_ALGORITHM_VERSION = "finding-dedupe-v1";
export const GROUPING_WRITE_BATCH_SIZE = 250;
export const GROUPING_RUNNING_STALE_MS = 15 * 60 * 1000;
export const GROUPING_ACTIVE_WAIT_MS = 5_000;
export const GROUPING_ACTIVE_POLL_MS = 100;
export const DETERMINISTIC_MAX_PAIR_COMPARISONS = 50_000;
export const IMPROVEMENT_ISSUE_CHUNK_SIZE = 50;
export const MAX_EVIDENCE_PER_ISSUE = 6;
export const MAX_SCANNER_SIGNALS_PER_ISSUE = 20;
export const MAX_ISSUE_DESCRIPTION_CHARS = 400;
export const MAX_EVIDENCE_SNIPPET_CHARS = 300;
export const IMPROVEMENT_WARNING_ROLLUP_VERSION =
	"improvement-warning-rollup-v2";
export const IMPROVEMENT_WARNING_ROLLUP_THRESHOLD = 10;
export const IMPROVEMENT_DEPENDENCY_ROLLUP_THRESHOLD = 2;
export const IMPROVEMENT_PROMPT_TARGET_CHARS = 48_000;
export const IMPROVEMENT_PROMPT_HARD_CHARS = 60_000;
export const MAX_WARNING_GROUP_EVIDENCE = 6;
export const MAX_WARNING_LOCATION_SAMPLES = 20;
