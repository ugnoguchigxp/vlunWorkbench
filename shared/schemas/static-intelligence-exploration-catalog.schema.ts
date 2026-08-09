import { z } from "zod";
import { codeStructureFileTagSchema } from "./static-intelligence-code-structure.schema";

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

function isProjectRelativePath(value: string): boolean {
	if (
		!value ||
		value.includes("\0") ||
		value.includes("\\") ||
		value.startsWith("/") ||
		/^[a-zA-Z]:/.test(value)
	) {
		return false;
	}
	return !value.split("/").some((segment) => segment === "..");
}

export const projectExplorationPathSchema = z
	.string()
	.trim()
	.min(1)
	.max(1024)
	.refine(isProjectRelativePath, "project_relative_path_required");

export const projectExplorationCatalogInputSchema = z
	.object({
		scanRunId: z.string().trim().min(1).max(256),
		generationId: z.string().uuid(),
		focus: z
			.object({
				paths: z.array(projectExplorationPathSchema).max(10).optional(),
				moduleIds: z.array(z.string().trim().min(1).max(256)).max(5).optional(),
				terms: z.array(z.string().trim().min(2).max(80)).max(10).optional(),
			})
			.strict(),
		limits: z
			.object({
				files: z.number().int().min(1).max(20).optional(),
				tests: z.number().int().min(0).max(10).optional(),
				verificationCommands: z.number().int().min(0).max(6).optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.superRefine((input, ctx) => {
		if (
			!input.focus.paths?.length &&
			!input.focus.moduleIds?.length &&
			!input.focus.terms?.length
		) {
			ctx.addIssue({
				code: "custom",
				path: ["focus"],
				message: "focus_required",
			});
		}
	});
export type ProjectExplorationCatalogInput = z.output<
	typeof projectExplorationCatalogInputSchema
>;

export const explorationFileReasonCodeSchema = z.enum([
	"focus_path_exact",
	"module_entrypoint",
	"imports_from_focus",
	"imports_focus",
	"exported_symbol_match",
	"declared_identifier_match",
	"path_term_match",
	"same_module_role",
]);
export type ExplorationFileReasonCode = z.infer<
	typeof explorationFileReasonCodeSchema
>;

export const explorationFileClueSchema = z
	.object({
		rank: z.number().int().positive(),
		path: projectExplorationPathSchema,
		roleTags: z.array(codeStructureFileTagSchema),
		reasonCodes: z.array(explorationFileReasonCodeSchema).min(1),
		sourceRefs: z.array(z.string().min(1)).min(1),
	})
	.strict();
export type ExplorationFileClue = z.infer<typeof explorationFileClueSchema>;

export const explorationTestClueSchema = z
	.object({
		rank: z.number().int().positive(),
		path: projectExplorationPathSchema,
		reasonCodes: z
			.array(
				z.enum([
					"focus_path_exact",
					"test_path_term_match",
					"direct_test_importer",
					"same_module_test",
				]),
			)
			.min(1),
		sourceRefs: z.array(z.string().min(1)).min(1),
	})
	.strict();
export type ExplorationTestClue = z.infer<typeof explorationTestClueSchema>;

export const explorationVerificationClueSchema = z
	.object({
		rank: z.number().int().positive(),
		command: z.string().trim().min(1),
		candidateOnly: z.literal(true),
		sourceRefs: z.array(z.string().min(1)).min(1),
	})
	.strict();
export type ExplorationVerificationClue = z.infer<
	typeof explorationVerificationClueSchema
>;

export const projectExplorationSourceRevisionSchema = z
	.object({
		kind: z.enum(["git", "tree_hash_only"]),
		head: z.string().min(1).optional(),
		dirtyHash: sha256HexSchema.optional(),
		value: z.string().min(1),
	})
	.strict()
	.superRefine((revision, ctx) => {
		if (revision.kind === "git" && !revision.head) {
			ctx.addIssue({
				code: "custom",
				path: ["head"],
				message: "git_source_revision_requires_head",
			});
		}
	});

export const projectExplorationCatalogSourceSchema = z
	.object({
		structureSchemaVersion: z.literal("project-structure-v2"),
		snapshotRef: z.string().min(1),
		revision: projectExplorationSourceRevisionSchema,
	})
	.strict();
export type ProjectExplorationCatalogSource = z.infer<
	typeof projectExplorationCatalogSourceSchema
>;

export const projectExplorationCatalogReadinessSchema = z
	.object({
		usability: z.enum(["usable", "degraded_usable", "unusable"]),
		reasonCodes: z.array(z.string().min(1)),
		coverage: z
			.object({
				inventoriedFiles: z.number().int().nonnegative(),
				analyzedFiles: z.number().int().nonnegative(),
				resolvedReferences: z.number().int().nonnegative(),
				unresolvedReferences: z.number().int().nonnegative(),
				inferredModules: z.number().int().nonnegative(),
			})
			.strict(),
	})
	.strict();
export type ProjectExplorationCatalogReadiness = z.infer<
	typeof projectExplorationCatalogReadinessSchema
>;

export const projectExplorationCatalogResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(["completed", "degraded"]),
		version: z.literal("v1"),
		generatedAt: z.string().datetime(),
		generation: z
			.object({
				projectId: z.string().min(1),
				scanRunId: z.string().min(1),
				generationId: z.string().uuid(),
				snapshotRef: z.string().min(1),
				sourceTreeHash: sha256HexSchema,
				sourceStateHash: sha256HexSchema,
				sourceRevision: projectExplorationSourceRevisionSchema,
				readiness: z.enum(["available", "stale", "degraded"]),
			})
			.strict(),
		focusResolution: z
			.object({
				matchedPaths: z.array(projectExplorationPathSchema),
				matchedModuleIds: z.array(z.string().min(1)),
				matchedTerms: z.array(z.string().min(1)),
				unmatched: z.array(z.string().min(1)),
			})
			.strict(),
		likelyFiles: z.array(explorationFileClueSchema),
		relatedTests: z.array(explorationTestClueSchema),
		verificationCandidates: z.array(explorationVerificationClueSchema),
		truncation: z
			.object({
				truncated: z.boolean(),
				omittedFiles: z.number().int().nonnegative(),
				omittedTests: z.number().int().nonnegative(),
				omittedVerificationCommands: z.number().int().nonnegative(),
			})
			.strict(),
		degradedReasons: z.array(z.string()),
	})
	.strict();
export type ProjectExplorationCatalogResult = z.infer<
	typeof projectExplorationCatalogResultSchema
>;

export const projectExplorationCatalogV2ResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(["completed", "degraded"]),
		version: z.literal("v2"),
		generatedAt: z.string().datetime(),
		source: projectExplorationCatalogSourceSchema,
		readiness: projectExplorationCatalogReadinessSchema,
		focusResolution: z
			.object({
				matchedPaths: z.array(projectExplorationPathSchema),
				matchedModuleIds: z.array(z.string().min(1)),
				matchedTerms: z.array(z.string().min(1)),
				unmatched: z.array(z.string().min(1)),
			})
			.strict(),
		likelyFiles: z.array(explorationFileClueSchema),
		relatedTests: z.array(explorationTestClueSchema),
		verificationCandidates: z.array(explorationVerificationClueSchema),
		truncation: z
			.object({
				truncated: z.boolean(),
				omittedFiles: z.number().int().nonnegative(),
				omittedTests: z.number().int().nonnegative(),
				omittedVerificationCommands: z.number().int().nonnegative(),
			})
			.strict(),
		degradedReasons: z.array(z.string()),
	})
	.strict();
export type ProjectExplorationCatalogV2Result = z.infer<
	typeof projectExplorationCatalogV2ResultSchema
>;

export const projectExplorationPathCatalogV2ResultSchema =
	projectExplorationCatalogV2ResultSchema
		.extend({
			freshness: z.object({ status: z.enum(["fresh", "stale"]) }).passthrough(),
			projectPath: z.string().min(1).optional(),
			provenance: z.record(z.string(), z.unknown()).optional(),
		})
		.passthrough();

export const projectExplorationCatalogFailureReasonSchema = z.enum([
	"invalid_input",
	"generation_missing",
	"generation_mismatch",
	"focus_required",
	"catalog_unavailable",
]);
export type ProjectExplorationCatalogFailureReason = z.infer<
	typeof projectExplorationCatalogFailureReasonSchema
>;

export const projectExplorationCatalogFailureSchema = z
	.object({
		ok: z.literal(false),
		status: z.literal("failed"),
		message: z.string(),
		reasonCode: projectExplorationCatalogFailureReasonSchema.optional(),
	})
	.strict();
export type ProjectExplorationCatalogFailure = z.infer<
	typeof projectExplorationCatalogFailureSchema
>;
