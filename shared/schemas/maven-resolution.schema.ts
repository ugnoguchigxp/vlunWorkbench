import { z } from "zod";

export const dependencyResolutionModeSchema = z.enum(["offline", "registry"]);

export const dependencyResolutionSchema = z
	.object({
		mode: dependencyResolutionModeSchema.default("offline"),
	})
	.strict()
	.default({ mode: "offline" });

const repositoryRelativePathSchema = z
	.string()
	.min(1)
	.max(500)
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.includes("\\") &&
			!/[\0\r\n]/.test(value) &&
			!value.split("/").includes(".."),
		"Path must be repository-relative and traversal-free.",
	);

const mavenCoordinatePartSchema = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9_.+-]+$/);
const safeModelEnvironmentNameSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[A-Z_][A-Z0-9_]*$/)
	.refine(
		(value) =>
			!/(?:^|_)(?:AUTH(?:ORIZATION)?|CREDENTIALS?|KEY|PASS(?:WORD)?|SECRET|TOKEN)(?:_|$)/i.test(
				value,
			),
		"Secret-like model environment names are not allowed.",
	);
const safeModelEnvironmentValueSchema = z
	.string()
	.max(500)
	.refine(
		(value) => !/[\0\r\n]/.test(value),
		"Model environment values must not contain control line breaks.",
	);

export const mavenLocalArtifactSchema = z
	.object({
		groupId: mavenCoordinatePartSchema,
		artifactId: mavenCoordinatePartSchema,
		version: mavenCoordinatePartSchema,
		packaging: z.literal("jar").default("jar"),
		path: repositoryRelativePathSchema,
		sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	})
	.strict();

export const mavenResolutionConfigSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootPom: repositoryRelativePathSchema.default("pom.xml"),
		modelEnvironment: z
			.record(safeModelEnvironmentNameSchema, safeModelEnvironmentValueSchema)
			.refine((value) => Object.keys(value).length <= 50, {
				message: "At most 50 model environment properties are allowed.",
			})
			.default({}),
		localArtifacts: z.array(mavenLocalArtifactSchema).max(50).default([]),
	})
	.strict()
	.superRefine((value, context) => {
		const coordinates = new Set<string>();
		for (const [index, artifact] of value.localArtifacts.entries()) {
			const coordinate = `${artifact.groupId}:${artifact.artifactId}:${artifact.packaging}:${artifact.version}`;
			if (coordinates.has(coordinate)) {
				context.addIssue({
					code: "custom",
					path: ["localArtifacts", index],
					message: `Duplicate local artifact coordinate: ${coordinate}`,
				});
			}
			coordinates.add(coordinate);
		}
	});

export type DependencyResolutionMode = z.infer<
	typeof dependencyResolutionModeSchema
>;
export type DependencyResolution = z.infer<typeof dependencyResolutionSchema>;
export type MavenLocalArtifact = z.infer<typeof mavenLocalArtifactSchema>;
export type MavenResolutionConfig = z.infer<typeof mavenResolutionConfigSchema>;
