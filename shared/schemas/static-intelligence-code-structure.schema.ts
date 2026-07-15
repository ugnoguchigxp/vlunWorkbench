import { z } from "zod";

export const codeStructureFileTagSchema = z.enum([
	"route",
	"handler",
	"schema",
	"worker",
	"test",
	"config",
	"source",
]);
export type CodeStructureFileTag = z.infer<typeof codeStructureFileTagSchema>;

export const codeStructureLanguageSchema = z.enum([
	"typescript",
	"javascript",
	"unknown",
]);
export type CodeStructureLanguage = z.infer<typeof codeStructureLanguageSchema>;

export const codeStructureModuleKindSchema = z.enum([
	"esm",
	"commonjs",
	"mixed",
	"unknown",
]);
export type CodeStructureModuleKind = z.infer<
	typeof codeStructureModuleKindSchema
>;

export const codeStructureFileSchema = z
	.object({
		path: z.string(),
		language: codeStructureLanguageSchema,
		moduleKind: codeStructureModuleKindSchema,
		tags: z.array(codeStructureFileTagSchema),
		exportedSymbols: z.array(z.string()),
		identifiers: z.array(z.string()).max(256).optional(),
		imports: z.array(z.string()),
		packageImports: z.array(z.string()),
		contentHash: z.string().regex(/^[a-f0-9]{64}$/),
		parseStatus: z.enum(["parsed", "degraded", "skipped"]),
		degradedReasons: z.array(z.string()),
	})
	.strict();
export type CodeStructureFile = z.infer<typeof codeStructureFileSchema>;

export const codeStructureEdgeSchema = z
	.object({
		from: z.string(),
		to: z.string(),
		kind: z.enum(["imports", "depends_on_package"]),
		confidence: z.number().min(0).max(1),
	})
	.strict();
export type CodeStructureEdge = z.infer<typeof codeStructureEdgeSchema>;

export const codeStructurePackageSchema = z
	.object({
		name: z.string(),
		importedBy: z.array(z.string()),
	})
	.strict();
export type CodeStructurePackage = z.infer<typeof codeStructurePackageSchema>;

export const codeStructureSummarySchema = z
	.object({
		fileCount: z.number().int().nonnegative(),
		parsedFileCount: z.number().int().nonnegative(),
		skippedFileCount: z.number().int().nonnegative(),
		importEdgeCount: z.number().int().nonnegative(),
		packageDependencyCount: z.number().int().nonnegative(),
		exportedSymbolCount: z.number().int().nonnegative(),
		routeFileCount: z.number().int().nonnegative(),
		handlerFileCount: z.number().int().nonnegative(),
		schemaFileCount: z.number().int().nonnegative(),
		workerFileCount: z.number().int().nonnegative(),
		testFileCount: z.number().int().nonnegative(),
		configFileCount: z.number().int().nonnegative(),
	})
	.strict();
export type CodeStructureSummary = z.infer<typeof codeStructureSummarySchema>;

export const codeStructureSnapshotSchema = z
	.object({
		version: z.literal("v1"),
		generatedAt: z.string(),
		project: z
			.object({
				id: z.string().optional(),
				rootRef: z.string().regex(/^[a-f0-9]{64}$/),
				rootPath: z.string().optional(),
				rootPathIncluded: z.boolean(),
			})
			.strict()
			.superRefine((project, ctx) => {
				if (!project.rootPathIncluded && project.rootPath !== undefined) {
					ctx.addIssue({
						code: "custom",
						message: "rootPath must be omitted when rootPathIncluded is false",
						path: ["rootPath"],
					});
				}
				if (project.rootPathIncluded && !project.rootPath) {
					ctx.addIssue({
						code: "custom",
						message: "rootPath is required when rootPathIncluded is true",
						path: ["rootPath"],
					});
				}
			}),
		status: z.enum(["completed", "partial"]),
		degradedReasons: z.array(z.string()),
		files: z.array(codeStructureFileSchema),
		edges: z.array(codeStructureEdgeSchema),
		packages: z.array(codeStructurePackageSchema),
		summary: codeStructureSummarySchema,
	})
	.strict();
export type CodeStructureSnapshot = z.infer<typeof codeStructureSnapshotSchema>;

export const codeStructureSnapshotResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		version: z.literal("v1"),
		generatedAt: z.string(),
		snapshot: codeStructureSnapshotSchema,
		output: z
			.object({
				path: z.string(),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
			})
			.strict()
			.optional(),
		generation: z
			.object({
				generationId: z.string().min(1),
				snapshotRef: z.string().min(1),
				sourceTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
			})
			.strict()
			.optional(),
	})
	.strict();
export type CodeStructureSnapshotResult = z.infer<
	typeof codeStructureSnapshotResultSchema
>;

export const codeStructureSnapshotFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
	})
	.strict();
export type CodeStructureSnapshotFailure = z.infer<
	typeof codeStructureSnapshotFailureSchema
>;
