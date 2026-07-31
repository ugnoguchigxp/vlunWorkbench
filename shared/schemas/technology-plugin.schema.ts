import { z } from "zod";

export const technologyPluginKindSchema = z.enum([
	"language",
	"build_system",
	"framework",
]);
export type TechnologyPluginKind = z.infer<typeof technologyPluginKindSchema>;

export const technologyPluginCapabilitySchema = z.enum([
	"source_detection",
	"sast",
	"dependency_detection",
	"dependency_scan",
	"project_structure",
	"endpoint_extraction",
	"schema_discovery",
	"dast_start",
]);
export type TechnologyPluginCapability = z.infer<
	typeof technologyPluginCapabilitySchema
>;

const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

export const technologyPluginManifestV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		pluginApiVersion: z.literal("1"),
		id: pluginIdSchema,
		version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
		kind: technologyPluginKindSchema,
		displayName: z.string().min(1).max(120),
		requires: z
			.object({
				allOf: z.array(pluginIdSchema),
				oneOf: z.array(pluginIdSchema),
			})
			.strict(),
		declaredCapabilities: z.array(technologyPluginCapabilitySchema),
	})
	.strict();
export type TechnologyPluginManifestV1 = z.infer<
	typeof technologyPluginManifestV1Schema
>;

export const projectPluginDetectionSchema = z
	.object({
		pluginId: pluginIdSchema,
		detected: z.boolean(),
		confidence: z.enum(["low", "medium", "high"]),
		evidence: z.array(
			z
				.object({
					path: z.string().min(1),
					kind: z.enum([
						"extension",
						"manifest",
						"dependency",
						"annotation",
						"config",
					]),
				})
				.strict(),
		),
		limitations: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectPluginDetection = z.infer<
	typeof projectPluginDetectionSchema
>;
