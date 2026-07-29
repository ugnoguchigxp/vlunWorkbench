import { z } from "zod";

export const scanTargetKindSchema = z.enum([
	"full",
	"commit",
	"range",
	"working_tree",
]);
export type ScanTargetKind = z.infer<typeof scanTargetKindSchema>;

function containsControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});
}

const gitRefSchema = z
	.string()
	.min(1)
	.max(1024)
	.refine((value) => !value.startsWith("-"), "Git ref cannot start with '-'.")
	.refine(
		(value) => !containsControlCharacter(value),
		"Git ref contains an invalid character.",
	);

export const scanTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("full") }),
	z.object({
		kind: z.literal("commit"),
		head: gitRefSchema,
		base: gitRefSchema.optional(),
	}),
	z.object({
		kind: z.literal("range"),
		base: gitRefSchema,
		head: gitRefSchema,
	}),
	z.object({
		kind: z.literal("working_tree"),
		base: gitRefSchema.optional(),
		includeUntracked: z.boolean().default(true),
	}),
]);
export type ScanTarget = z.infer<typeof scanTargetSchema>;

export const diffPathStatusSchema = z.enum([
	"added",
	"modified",
	"deleted",
	"renamed",
	"copied",
	"type_changed",
	"unmerged",
	"untracked",
	"gitlink",
]);
export type DiffPathStatus = z.infer<typeof diffPathStatusSchema>;

export const diffDispositionSchema = z.enum([
	"scan",
	"deleted",
	"excluded",
	"unsupported",
	"too_large",
]);
export type DiffDisposition = z.infer<typeof diffDispositionSchema>;

export const diffCoverageReasonCodeSchema = z.enum([
	"deleted_path",
	"profile_excluded",
	"binary_not_supported",
	"gitlink_not_materialized",
	"symlink_escape",
	"symlink_target_not_materialized",
	"path_not_materialized",
	"unmerged_path",
	"unsupported_file_type",
	"file_too_large",
]);
export type DiffCoverageReasonCode = z.infer<
	typeof diffCoverageReasonCodeSchema
>;

export const diffTargetErrorCodeSchema = z.enum([
	"not_a_git_repository",
	"git_ref_not_found",
	"ambiguous_commit_parent",
	"merge_base_not_found",
	"unmerged_worktree",
	"target_changed",
	"diff_target_too_large",
	"snapshot_materialization_failed",
	"snapshot_digest_mismatch",
	"invalid_diff_path",
]);
export type DiffTargetErrorCode = z.infer<typeof diffTargetErrorCodeSchema>;

export const diffManifestEntrySchema = z.object({
	status: diffPathStatusSchema,
	path: z.string().min(1),
	oldPath: z.string().min(1).optional(),
	contentSha256: z.string().length(64).optional(),
	sizeBytes: z.number().int().nonnegative().optional(),
	binary: z.boolean(),
	inProfileScope: z.boolean(),
	disposition: diffDispositionSchema,
	reasonCode: diffCoverageReasonCodeSchema.nullable(),
});
export type DiffManifestEntry = z.infer<typeof diffManifestEntrySchema>;

export const diffCoverageSchema = z.object({
	changed: z.number().int().nonnegative(),
	scannable: z.number().int().nonnegative(),
	deleted: z.number().int().nonnegative(),
	excluded: z.number().int().nonnegative(),
	unsupported: z.number().int().nonnegative(),
	tooLarge: z.number().int().nonnegative(),
});
export type DiffCoverage = z.infer<typeof diffCoverageSchema>;

export const resolvedScanTargetSchema = z.object({
	schemaVersion: z.literal(1),
	kind: z.enum(["commit", "range", "working_tree"]),
	requested: scanTargetSchema,
	projectPrefix: z.string(),
	baseSha: z.string().regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/i),
	headSha: z
		.string()
		.regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/i)
		.nullable(),
	mergeBaseSha: z
		.string()
		.regex(/^([0-9a-f]{40}|[0-9a-f]{64})$/i)
		.nullable(),
	includeUntracked: z.boolean(),
	targetDigest: z.string().length(64),
	snapshotDigest: z.string().length(64).nullable(),
	changedFileCount: z.number().int().nonnegative(),
	scannableFileCount: z.number().int().nonnegative(),
});
export type ResolvedScanTarget = z.infer<typeof resolvedScanTargetSchema>;

export const diffManifestSchema = z.object({
	schemaVersion: z.literal(1),
	target: resolvedScanTargetSchema,
	limits: z.object({
		maxFiles: z.number().int().positive(),
		maxTotalBytes: z.number().int().positive(),
		maxSingleFileBytes: z.number().int().positive(),
	}),
	coverage: diffCoverageSchema,
	entries: z.array(diffManifestEntrySchema),
});
export type DiffManifest = z.infer<typeof diffManifestSchema>;

export const diffToolApplicabilitySchema = z.object({
	toolId: z.string(),
	applicability: z.enum(["applicable", "not_applicable"]),
	reasonCode: z
		.enum([
			"no_changed_files",
			"no_relevant_files",
			"no_dependency_manifest_changed",
		])
		.nullable(),
	coverageEffect: z.enum(["covered", "partial", "gap"]),
	changedFileCount: z.number().int().nonnegative(),
	contextFileCount: z.number().int().nonnegative(),
});
export type DiffToolApplicability = z.infer<typeof diffToolApplicabilitySchema>;

export const diffScanPreviewSchema = z.object({
	target: resolvedScanTargetSchema,
	coverage: diffCoverageSchema,
	entries: z.array(
		diffManifestEntrySchema.omit({
			contentSha256: true,
			sizeBytes: true,
		}),
	),
	tools: z.array(diffToolApplicabilitySchema),
});
export type DiffScanPreview = z.infer<typeof diffScanPreviewSchema>;
