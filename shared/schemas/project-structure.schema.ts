import { z } from "zod";
import {
	codeStructureFileTagSchema,
	codeStructureModuleKindSchema,
} from "./static-intelligence-code-structure.schema";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const projectStructureInventoryKindSchema = z.enum([
	"source",
	"style",
	"markup",
	"manifest",
	"config",
	"resource",
]);
export type ProjectStructureInventoryKind = z.infer<
	typeof projectStructureInventoryKindSchema
>;

export const projectStructureDiagnosticScopeSchema = z.enum([
	"inventory",
	"analysis",
	"resolution",
	"module_inference",
	"persistence",
]);
export type ProjectStructureDiagnosticScope = z.infer<
	typeof projectStructureDiagnosticScopeSchema
>;

export const projectStructureDiagnosticImpactSchema = z.enum([
	"none",
	"degraded",
	"failed",
]);
export type ProjectStructureDiagnosticImpact = z.infer<
	typeof projectStructureDiagnosticImpactSchema
>;

export const projectStructureDiagnosticSchema = z
	.object({
		code: z.string().min(1),
		scope: projectStructureDiagnosticScopeSchema,
		severity: z.enum(["info", "warning", "error"]),
		impact: projectStructureDiagnosticImpactSchema,
		path: z.string().min(1).optional(),
		specifier: z.string().min(1).optional(),
		analyzerId: z.string().min(1).optional(),
		count: z.number().int().positive().optional(),
	})
	.strict();
export type ProjectStructureDiagnostic = z.infer<
	typeof projectStructureDiagnosticSchema
>;

export const projectStructureInventoryEntrySchema = z
	.object({
		path: z.string().min(1),
		realPathRef: hashSchema,
		kind: projectStructureInventoryKindSchema,
		mediaType: z.string().min(1),
		sizeBytes: z.number().int().nonnegative(),
		hashMode: z.enum(["content", "path_only"]),
		contentHash: hashSchema.optional(),
		analyzerIds: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectStructureInventoryEntry = z.infer<
	typeof projectStructureInventoryEntrySchema
>;

export const projectStructureCoverageSchema = z
	.object({
		discoveredFileCount: z.number().int().nonnegative(),
		includedFileCount: z.number().int().nonnegative(),
		analyzableFileCount: z.number().int().nonnegative(),
		unsupportedFileCount: z.number().int().nonnegative(),
		resourceFileCount: z.number().int().nonnegative(),
		excludedFileCount: z.number().int().nonnegative(),
		excludedByReason: z.record(z.string(), z.number().int().nonnegative()),
		unhashedFileCount: z.number().int().nonnegative(),
		totalIncludedBytes: z.number().int().nonnegative(),
		budgetHit: z.boolean(),
	})
	.strict();
export type ProjectStructureCoverage = z.infer<
	typeof projectStructureCoverageSchema
>;

export const projectStructureReferenceSchema = z
	.object({
		from: z.string().min(1),
		specifier: z.string().min(1),
		kind: z.enum([
			"code_module",
			"stylesheet",
			"asset",
			"manifest",
			"workspace_package",
			"external_package",
			"runtime_builtin",
			"virtual_module",
			"remote_url",
		]),
		status: z.enum([
			"resolved",
			"resolved_unparsed",
			"external",
			"ambiguous",
			"unresolved",
			"blocked",
		]),
		target: z.string().min(1).optional(),
		resolverId: z.string().min(1),
		confidence: z.number().min(0).max(1),
		diagnosticCodes: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectStructureReference = z.infer<
	typeof projectStructureReferenceSchema
>;

export const projectStructureFileSchema = z
	.object({
		path: z.string().min(1),
		analyzerId: z.string().min(1),
		language: z.string().min(1),
		moduleKind: codeStructureModuleKindSchema,
		tags: z.array(codeStructureFileTagSchema),
		exportedSymbols: z.array(z.string()),
		identifiers: z.array(z.string()).max(256),
		contentHash: hashSchema,
		status: z.enum(["analyzed", "partial", "failed"]),
		diagnosticCodes: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectStructureFile = z.infer<typeof projectStructureFileSchema>;

export const projectStructureModuleSchema = z
	.object({
		id: z.string().min(1),
		label: z.string().min(1),
		pathPrefix: z.string().min(1),
		boundaryKind: z.enum([
			"workspace",
			"package",
			"entrypoint",
			"graph",
			"directory",
		]),
		files: z.array(z.string().min(1)),
		entrypoints: z.array(z.string().min(1)),
		internalDependencies: z.array(z.string().min(1)),
		externalDependencies: z.array(z.string().min(1)),
		confidence: z.number().min(0).max(1),
		confidenceReasons: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectStructureModule = z.infer<
	typeof projectStructureModuleSchema
>;

export const projectStructureStageReadinessSchema = z
	.object({
		status: z.enum(["available", "degraded", "failed"]),
		reasonCodes: z.array(z.string().min(1)),
	})
	.strict();
export type ProjectStructureStageReadiness = z.infer<
	typeof projectStructureStageReadinessSchema
>;

export const projectStructureSummarySchema = z
	.object({
		fileCount: z.number().int().nonnegative(),
		analyzedFileCount: z.number().int().nonnegative(),
		styleFileCount: z.number().int().nonnegative(),
		markupFileCount: z.number().int().nonnegative(),
		resourceFileCount: z.number().int().nonnegative(),
		resolvedReferenceCount: z.number().int().nonnegative(),
		unresolvedReferenceCount: z.number().int().nonnegative(),
		moduleCount: z.number().int().nonnegative(),
	})
	.strict();
export type ProjectStructureSummary = z.infer<
	typeof projectStructureSummarySchema
>;

export const projectStructureSnapshotV2Schema = z
	.object({
		version: z.literal("v2"),
		generatedAt: z.string(),
		project: z
			.object({
				id: z.string().optional(),
				rootRef: hashSchema,
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
		structureInputHash: hashSchema,
		inventory: z
			.object({
				entries: z.array(projectStructureInventoryEntrySchema),
				coverage: projectStructureCoverageSchema,
			})
			.strict(),
		files: z.array(projectStructureFileSchema),
		references: z.array(projectStructureReferenceSchema),
		modules: z.array(projectStructureModuleSchema),
		packages: z.array(
			z
				.object({
					name: z.string().min(1),
					importedBy: z.array(z.string().min(1)),
				})
				.strict(),
		),
		diagnostics: z.array(projectStructureDiagnosticSchema),
		readiness: z
			.object({
				inventory: projectStructureStageReadinessSchema,
				analysis: projectStructureStageReadinessSchema,
				resolution: projectStructureStageReadinessSchema,
				moduleInference: projectStructureStageReadinessSchema,
			})
			.strict(),
		summary: projectStructureSummarySchema,
	})
	.strict();
export type ProjectStructureSnapshotV2 = z.infer<
	typeof projectStructureSnapshotV2Schema
>;

export const projectStructureSnapshotResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.literal("completed"),
		version: z.literal("v2"),
		generatedAt: z.string(),
		snapshot: projectStructureSnapshotV2Schema,
		output: z
			.object({
				path: z.string(),
				sha256: hashSchema,
			})
			.strict()
			.optional(),
	})
	.strict();
export type ProjectStructureSnapshotResult = z.infer<
	typeof projectStructureSnapshotResultSchema
>;

export const projectStructureSnapshotFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
	})
	.strict();
export type ProjectStructureSnapshotFailure = z.infer<
	typeof projectStructureSnapshotFailureSchema
>;
