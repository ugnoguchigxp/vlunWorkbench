import { z } from "zod";
import { projectPluginDetectionSchema } from "./technology-plugin.schema";

const sha256RefSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const projectCapabilityStepV1Schema = z
	.object({
		stepId: z.string().min(1),
		pluginIds: z.array(z.string().min(1)),
		applicability: z.enum(["applicable", "not_applicable"]),
		reasonCode: z.string().min(1).nullable(),
		coverageEffect: z.enum(["covered", "partial", "gap"]),
		limitationCodes: z.array(z.string().min(1)).default([]),
	})
	.strict();
export type ProjectCapabilityStepV1 = z.infer<
	typeof projectCapabilityStepV1Schema
>;

export const projectCapabilityPlanV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		registryDigest: sha256RefSchema,
		activePluginIds: z.array(z.string().min(1)),
		languages: z.array(z.string().min(1)),
		buildSystems: z.array(z.string().min(1)),
		frameworks: z.array(z.string().min(1)),
		steps: z.array(projectCapabilityStepV1Schema),
	})
	.strict();
export type ProjectCapabilityPlanV1 = z.infer<
	typeof projectCapabilityPlanV1Schema
>;

export const pluginExecutionSummaryV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		registryDigest: sha256RefSchema,
		detections: z.array(projectPluginDetectionSchema),
		capabilityPlan: projectCapabilityPlanV1Schema,
		pluginResults: z.array(
			z
				.object({
					pluginId: z.string().min(1),
					capability: z.string().min(1),
					status: z.enum(["completed", "failed", "skipped"]),
					coverageEffect: z.enum(["covered", "partial", "gap"]),
					limitationCodes: z.array(z.string().min(1)),
				})
				.strict(),
		),
	})
	.strict();
export type PluginExecutionSummaryV1 = z.infer<
	typeof pluginExecutionSummaryV1Schema
>;
