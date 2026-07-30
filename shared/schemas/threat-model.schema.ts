import { z } from "zod";
import { modelEvidenceRefSchema } from "./application-model.schema";

export const threatHypothesisStatusSchema = z.enum([
	"hypothesis",
	"planned",
	"observed",
	"not_observed",
	"inconclusive",
	"not_tested",
]);

export const threatHypothesisSchema = z
	.object({
		id: z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,199}$/),
		modelSnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		title: z.string().min(1).max(500),
		category: z.enum([
			"spoofing",
			"tampering",
			"repudiation",
			"information_disclosure",
			"denial_of_service",
			"elevation_of_privilege",
			"business_logic",
		]),
		actorIds: z.array(z.string()).max(100),
		assetIds: z.array(z.string()).max(100),
		entrypointIds: z.array(z.string()).max(500),
		preconditions: z.array(z.string().min(1).max(1000)).max(100),
		expectedImpact: z.string().min(1).max(2000),
		evidenceRefs: z.array(modelEvidenceRefSchema).min(1).max(500),
		confidence: z.enum(["high", "medium", "low"]),
		criticality: z.literal("unknown").default("unknown"),
		validationKind: z.enum([
			"authorization_matrix",
			"state_transition",
			"metamorphic",
			"bounded_transaction",
			"static_query",
			"unsupported",
		]),
		status: threatHypothesisStatusSchema,
	})
	.strict();

export const threatModelRunStatusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"completed_with_limitations",
	"failed",
]);

export type ThreatHypothesis = z.infer<typeof threatHypothesisSchema>;
export type ThreatModelRunStatus = z.infer<typeof threatModelRunStatusSchema>;
