import { z } from "zod";

export const scanProgressStepKindSchema = z.enum([
	"static_tool",
	"dast",
	"runtime_scanner",
	"sbom_export",
	"api_schema_scan",
	"container_image_scan",
	"attestation_verify",
]);
export type ScanProgressStepKind = z.infer<typeof scanProgressStepKindSchema>;

export const scanProgressStepOutcomeSchema = z.enum([
	"completed",
	"failed",
	"skipped",
	"not_applicable",
	"blocked",
]);
export type ScanProgressStepOutcome = z.infer<
	typeof scanProgressStepOutcomeSchema
>;

const scanProgressStepEventBaseSchema = z.object({
	schemaVersion: z.literal(1),
	stepId: z.string().min(1).max(160),
	kind: scanProgressStepKindSchema,
	adapter: z.string().min(1).max(100),
	displayName: z.string().min(1).max(200),
	position: z.number().int().positive(),
	totalSteps: z.number().int().positive(),
	required: z.boolean(),
	planHash: z.string().min(1).max(200),
});

export const scanStepStartedEventDataSchema = scanProgressStepEventBaseSchema;
export type ScanStepStartedEventData = z.infer<
	typeof scanStepStartedEventDataSchema
>;

export const scanStepFinishedEventDataSchema =
	scanProgressStepEventBaseSchema.extend({
		outcome: scanProgressStepOutcomeSchema,
		findingCount: z.number().int().nonnegative(),
		reasonCode: z.string().min(1).max(160).nullable(),
		durationMs: z.number().int().nonnegative().nullable(),
	});
export type ScanStepFinishedEventData = z.infer<
	typeof scanStepFinishedEventDataSchema
>;
