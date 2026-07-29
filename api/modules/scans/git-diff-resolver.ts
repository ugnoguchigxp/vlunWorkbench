import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type {
	DiffCoverageReasonCode,
	DiffManifestEntry,
	DiffPathStatus,
	DiffTargetErrorCode,
	ScanTarget,
} from "../../../shared/schemas/scan-target.schema";
import { GitCommandError, runGitCommand, runGitText } from "./git-command";
import { matchesScopePath } from "./target-scope";

export const DIFF_SCAN_LIMITS = {
	maxFiles: 5_000,
	maxTotalBytes: 512 * 1024 * 1024,
	maxSingleFileBytes: 20 * 1024 * 1024,
} as const;

type RawDiffEntry = {
	status: DiffPathStatus;
	path: string;
	oldPath?: string;
};

type TreeEntry = {
	mode: string;
	type: string;
	objectId: string;
	size: number | null;
};

export type ResolvedGitDiff = {
	gitRoot: string;
	projectRoot: string;
	projectPrefix: string;
	requested: Exclude<ScanTarget, { kind: "full" }>;
	baseSha: string;
	headSha: string | null;
	mergeBaseSha: string | null;
	includeUntracked: boolean;
	entries: DiffManifestEntry[];
};

export class GitDiffResolutionError extends Error {
	constructor(
		readonly code: DiffTargetErrorCode,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "GitDiffResolutionError";
	}
}

export async function resolveGitDiff(params: {
	projectPath: string;
	target: Exclude<ScanTarget, { kind: "full" }>;
	scope?: ScanScopePolicy;
}): Promise<ResolvedGitDiff> {
	const projectRoot = await fs.realpath(params.projectPath).catch(() => null);
	if (!projectRoot) {
		throw new GitDiffResolutionError(
			"not_a_git_repository",
			"Project path is not readable.",
		);
	}
	const gitRoot = await resolveGitRoot(projectRoot);
	const projectPrefix = normalizeProjectPrefix(
		path.relative(gitRoot, projectRoot),
	);
	if (projectPrefix.startsWith("../") || path.isAbsolute(projectPrefix)) {
		throw new GitDiffResolutionError(
			"not_a_git_repository",
			"Project path is outside the resolved Git root.",
		);
	}
	if (projectPrefix === ".git" || projectPrefix.startsWith(".git/")) {
		throw new GitDiffResolutionError(
			"not_a_git_repository",
			"Git administrative directories cannot be scanned as projects.",
		);
	}

	const revisions = await resolveRevisions(gitRoot, params.target);
	const rawEntries =
		params.target.kind === "working_tree"
			? await resolveWorkingTreeEntries({
					gitRoot,
					projectPrefix,
					baseSha: revisions.baseSha,
					includeUntracked: params.target.includeUntracked,
				})
			: await resolveCommittedEntries({
					gitRoot,
					projectPrefix,
					baseSha: revisions.baseSha,
					headSha: revisions.headSha as string,
				});

	if (rawEntries.length > DIFF_SCAN_LIMITS.maxFiles) {
		throw new GitDiffResolutionError(
			"diff_target_too_large",
			`Diff contains ${rawEntries.length} entries; limit is ${DIFF_SCAN_LIMITS.maxFiles}.`,
			{ changedFileCount: rawEntries.length },
		);
	}

	const entries =
		params.target.kind === "working_tree"
			? await enrichWorkingTreeEntries({
					gitRoot,
					projectRoot,
					projectPrefix,
					rawEntries,
					scope: params.scope,
				})
			: await enrichCommittedEntries({
					gitRoot,
					projectPrefix,
					headSha: revisions.headSha as string,
					rawEntries,
					scope: params.scope,
				});

	const totalBytes = entries.reduce(
		(total, entry) => total + (entry.sizeBytes ?? 0),
		0,
	);
	if (totalBytes > DIFF_SCAN_LIMITS.maxTotalBytes) {
		throw new GitDiffResolutionError(
			"diff_target_too_large",
			`Diff contains ${totalBytes} bytes; limit is ${DIFF_SCAN_LIMITS.maxTotalBytes}.`,
			{ totalBytes },
		);
	}
	return {
		gitRoot,
		projectRoot,
		projectPrefix,
		requested: params.target,
		baseSha: revisions.baseSha,
		headSha: revisions.headSha,
		mergeBaseSha: revisions.mergeBaseSha,
		includeUntracked:
			params.target.kind === "working_tree"
				? params.target.includeUntracked
				: false,
		entries: sortEntries(entries),
	};
}

async function resolveGitRoot(projectRoot: string): Promise<string> {
	try {
		const output = await runGitText({
			cwd: projectRoot,
			args: ["rev-parse", "--show-toplevel"],
		});
		return await fs.realpath(output.trim());
	} catch {
		throw new GitDiffResolutionError(
			"not_a_git_repository",
			"Project path is not inside a Git worktree.",
		);
	}
}

async function resolveRevisions(
	gitRoot: string,
	target: Exclude<ScanTarget, { kind: "full" }>,
): Promise<{
	baseSha: string;
	headSha: string | null;
	mergeBaseSha: string | null;
}> {
	if (target.kind === "working_tree") {
		return {
			baseSha: await resolveCommit(gitRoot, target.base ?? "HEAD"),
			headSha: null,
			mergeBaseSha: null,
		};
	}
	const headSha = await resolveCommit(gitRoot, target.head);
	if (target.kind === "range") {
		const requestedBase = await resolveCommit(gitRoot, target.base);
		try {
			const mergeBaseSha = (
				await runGitText({
					cwd: gitRoot,
					args: ["merge-base", requestedBase, headSha],
				})
			).trim();
			if (!mergeBaseSha) throw new Error("empty merge base");
			return {
				baseSha: mergeBaseSha,
				headSha,
				mergeBaseSha,
			};
		} catch {
			throw new GitDiffResolutionError(
				"merge_base_not_found",
				"Base and head do not have a merge base.",
			);
		}
	}
	if (target.base) {
		return {
			baseSha: await resolveCommit(gitRoot, target.base),
			headSha,
			mergeBaseSha: null,
		};
	}
	const parentLine = (
		await runGitText({
			cwd: gitRoot,
			args: ["rev-list", "--parents", "-n", "1", headSha],
		})
	)
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const parents = parentLine.slice(1);
	if (parents.length > 1) {
		throw new GitDiffResolutionError(
			"ambiguous_commit_parent",
			"Merge commit requires an explicit base or parent.",
			{ parentCount: parents.length },
		);
	}
	return {
		baseSha: parents[0] ?? (await resolveEmptyTree(gitRoot)),
		headSha,
		mergeBaseSha: null,
	};
}

async function resolveCommit(gitRoot: string, ref: string): Promise<string> {
	const containsControlCharacter = Array.from(ref).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});
	if (
		!ref ||
		ref.length > 1024 ||
		ref.startsWith("-") ||
		containsControlCharacter
	) {
		throw new GitDiffResolutionError("git_ref_not_found", "Invalid Git ref.");
	}
	try {
		const resolved = (
			await runGitText({
				cwd: gitRoot,
				args: ["rev-parse", "--verify", `${ref}^{commit}`],
			})
		).trim();
		if (!/^[0-9a-f]{40,64}$/i.test(resolved)) {
			throw new Error("invalid object id");
		}
		return resolved;
	} catch {
		throw new GitDiffResolutionError(
			"git_ref_not_found",
			`Git ref could not be resolved: ${ref}`,
		);
	}
}

async function resolveEmptyTree(gitRoot: string): Promise<string> {
	return (
		await runGitText({
			cwd: gitRoot,
			args: ["hash-object", "-t", "tree", "--stdin"],
			input: "",
		})
	).trim();
}

async function resolveCommittedEntries(params: {
	gitRoot: string;
	projectPrefix: string;
	baseSha: string;
	headSha: string;
}): Promise<RawDiffEntry[]> {
	const args = [
		"diff",
		"--name-status",
		"-z",
		"--find-renames",
		"--find-copies",
		"--find-copies-harder",
		"--no-ext-diff",
		params.baseSha,
		params.headSha,
		"--",
		...pathspec(params.projectPrefix),
	];
	return parseNameStatus(
		(await runGitCommand({ cwd: params.gitRoot, args })).stdout,
		params.projectPrefix,
	);
}

async function resolveWorkingTreeEntries(params: {
	gitRoot: string;
	projectPrefix: string;
	baseSha: string;
	includeUntracked: boolean;
}): Promise<RawDiffEntry[]> {
	const tracked = parseNameStatus(
		(
			await runGitCommand({
				cwd: params.gitRoot,
				args: [
					"diff",
					"--name-status",
					"-z",
					"--find-renames",
					"--find-copies",
					"--find-copies-harder",
					"--no-ext-diff",
					params.baseSha,
					"--",
					...pathspec(params.projectPrefix),
				],
			})
		).stdout,
		params.projectPrefix,
	);
	const unmergedOutput = (
		await runGitCommand({
			cwd: params.gitRoot,
			args: [
				"ls-files",
				"--unmerged",
				"-z",
				"--",
				...pathspec(params.projectPrefix),
			],
		})
	).stdout;
	const unmerged = splitNul(unmergedOutput).map((record) => {
		const tab = record.indexOf("\t");
		if (tab < 0) {
			throw new GitDiffResolutionError(
				"invalid_diff_path",
				"Git returned an invalid unmerged index record.",
			);
		}
		return {
			status: "unmerged" as const,
			path: toProjectPath(record.slice(tab + 1), params.projectPrefix),
		};
	});
	const trackedWithConflicts = dedupeRawEntries([...tracked, ...unmerged]);
	if (!params.includeUntracked) return trackedWithConflicts;
	const untrackedOutput = (
		await runGitCommand({
			cwd: params.gitRoot,
			args: [
				"ls-files",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
				...pathspec(params.projectPrefix),
			],
		})
	).stdout;
	const untracked = splitNul(untrackedOutput).map((gitPath) => ({
		status: "untracked" as const,
		path: toProjectPath(gitPath, params.projectPrefix),
	}));
	return dedupeRawEntries([...trackedWithConflicts, ...untracked]);
}

function parseNameStatus(
	output: Buffer,
	projectPrefix: string,
): RawDiffEntry[] {
	const tokens = splitNul(output);
	const result: RawDiffEntry[] = [];
	for (let index = 0; index < tokens.length; ) {
		const statusToken = tokens[index++];
		if (!statusToken) {
			throw new GitDiffResolutionError(
				"invalid_diff_path",
				"Git returned an empty name-status record.",
			);
		}
		const statusCode = statusToken[0];
		if (statusCode === "R" || statusCode === "C") {
			const oldGitPath = tokens[index++];
			const gitPath = tokens[index++];
			if (oldGitPath === undefined || gitPath === undefined) {
				throw new GitDiffResolutionError(
					"invalid_diff_path",
					"Git returned an incomplete rename/copy record.",
				);
			}
			const oldInside = isGitPathInsideProject(oldGitPath, projectPrefix);
			const newInside = isGitPathInsideProject(gitPath, projectPrefix);
			if (oldInside && newInside) {
				result.push({
					status: statusCode === "R" ? "renamed" : "copied",
					oldPath: toProjectPath(oldGitPath, projectPrefix),
					path: toProjectPath(gitPath, projectPrefix),
				});
			} else if (newInside) {
				result.push({
					status: "added",
					path: toProjectPath(gitPath, projectPrefix),
				});
			} else if (oldInside && statusCode === "R") {
				result.push({
					status: "deleted",
					path: toProjectPath(oldGitPath, projectPrefix),
				});
			}
			continue;
		}
		const gitPath = tokens[index++];
		if (gitPath === undefined) {
			throw new GitDiffResolutionError(
				"invalid_diff_path",
				"Git returned an incomplete name-status record.",
			);
		}
		result.push({
			status: mapStatus(statusCode),
			path: toProjectPath(gitPath, projectPrefix),
		});
	}
	return dedupeRawEntries(result);
}

function mapStatus(status: string): DiffPathStatus {
	switch (status) {
		case "A":
			return "added";
		case "M":
			return "modified";
		case "D":
			return "deleted";
		case "T":
			return "type_changed";
		case "U":
			return "unmerged";
		default:
			throw new GitDiffResolutionError(
				"invalid_diff_path",
				`Git returned an unsupported diff status: ${status || "(empty)"}`,
			);
	}
}

async function enrichCommittedEntries(params: {
	gitRoot: string;
	projectPrefix: string;
	headSha: string;
	rawEntries: RawDiffEntry[];
	scope?: ScanScopePolicy;
}): Promise<DiffManifestEntry[]> {
	const treeEntries = await readTreeEntries(
		params.gitRoot,
		params.headSha,
		params.projectPrefix,
	);
	const result: DiffManifestEntry[] = [];
	let totalBytes = 0;
	const accountBytes = (sizeBytes: number) => {
		totalBytes += sizeBytes;
		if (totalBytes > DIFF_SCAN_LIMITS.maxTotalBytes) {
			throw new GitDiffResolutionError(
				"diff_target_too_large",
				`Diff contains more than ${DIFF_SCAN_LIMITS.maxTotalBytes} bytes.`,
				{ totalBytes },
			);
		}
	};
	for (const entry of params.rawEntries) {
		if (entry.status === "deleted") {
			result.push(baseDeletedEntry(entry, params.scope));
			continue;
		}
		if (entry.status === "unmerged") {
			result.push({
				...baseEntry(entry, params.scope),
				binary: false,
				disposition: "unsupported",
				reasonCode: "unmerged_path",
			});
			continue;
		}
		const gitPath = fromProjectPath(entry.path, params.projectPrefix);
		const treeEntry = treeEntries.get(gitPath);
		if (!treeEntry) {
			result.push(unsupportedEntry(entry, params.scope));
			continue;
		}
		if (treeEntry.mode === "160000" || treeEntry.type === "commit") {
			result.push({
				...baseEntry(entry, params.scope),
				status: "gitlink",
				binary: false,
				disposition: "unsupported",
				reasonCode: "gitlink_not_materialized",
			});
			continue;
		}
		const sizePreAccounted =
			treeEntry.mode !== "120000" && treeEntry.size !== null;
		if (sizePreAccounted) accountBytes(treeEntry.size as number);
		const resolvedContent = await readCommittedContent({
			gitRoot: params.gitRoot,
			projectPrefix: params.projectPrefix,
			entryPath: entry.path,
			treeEntry,
			treeEntries,
			scope: params.scope,
		});
		if (resolvedContent.kind === "too_large") {
			if (!sizePreAccounted) accountBytes(resolvedContent.sizeBytes);
			result.push({
				...baseEntry(entry, params.scope),
				sizeBytes: resolvedContent.sizeBytes,
				binary: false,
				disposition: "too_large",
				reasonCode: "file_too_large",
			});
			continue;
		}
		if (resolvedContent.kind === "unsupported") {
			result.push(
				unsupportedEntry(entry, params.scope, resolvedContent.reasonCode),
			);
			continue;
		}
		if (resolvedContent.kind === "excluded") {
			if (!sizePreAccounted) accountBytes(resolvedContent.sizeBytes ?? 0);
			result.push(
				excludedEntry(entry, params.scope, resolvedContent.sizeBytes),
			);
			continue;
		}
		if (!sizePreAccounted) accountBytes(resolvedContent.content.length);
		result.push(contentEntry(entry, params.scope, resolvedContent.content));
	}
	return result;
}

type CommittedContentResolution =
	| { kind: "content"; content: Buffer }
	| { kind: "too_large"; sizeBytes: number }
	| { kind: "excluded"; sizeBytes: number | undefined }
	| { kind: "unsupported"; reasonCode: DiffCoverageReasonCode };

async function readCommittedContent(params: {
	gitRoot: string;
	projectPrefix: string;
	entryPath: string;
	treeEntry: TreeEntry;
	treeEntries: Map<string, TreeEntry>;
	scope?: ScanScopePolicy;
}): Promise<CommittedContentResolution> {
	let currentPath = params.entryPath;
	let currentEntry = params.treeEntry;
	const visited = new Set<string>();

	for (let depth = 0; depth < 32; depth++) {
		if (
			currentPath !== params.entryPath &&
			!matchesScopePath(currentPath, params.scope)
		) {
			return {
				kind: "excluded",
				sizeBytes: currentEntry.size ?? undefined,
			};
		}
		if (currentEntry.mode === "160000" || currentEntry.type !== "blob") {
			return {
				kind: "unsupported",
				reasonCode: "unsupported_file_type",
			};
		}
		if (
			currentEntry.size !== null &&
			currentEntry.size > DIFF_SCAN_LIMITS.maxSingleFileBytes
		) {
			return { kind: "too_large", sizeBytes: currentEntry.size };
		}
		const visitKey = `${currentPath}\0${currentEntry.objectId}`;
		if (visited.has(visitKey)) {
			return {
				kind: "unsupported",
				reasonCode: "symlink_target_not_materialized",
			};
		}
		visited.add(visitKey);

		const content = (
			await runGitCommand({
				cwd: params.gitRoot,
				args: ["cat-file", "blob", currentEntry.objectId],
				maxBufferBytes: DIFF_SCAN_LIMITS.maxSingleFileBytes + 1,
			})
		).stdout;
		if (currentEntry.mode !== "120000") {
			return { kind: "content", content };
		}

		let linkTarget: string;
		try {
			linkTarget = new TextDecoder("utf-8", { fatal: true }).decode(content);
		} catch {
			return {
				kind: "unsupported",
				reasonCode: "symlink_target_not_materialized",
			};
		}
		if (symlinkTargetEscapesProject(currentPath, linkTarget)) {
			return { kind: "unsupported", reasonCode: "symlink_escape" };
		}
		currentPath = path.posix.normalize(
			path.posix.join(path.posix.dirname(currentPath), linkTarget),
		);
		const targetEntry = params.treeEntries.get(
			fromProjectPath(currentPath, params.projectPrefix),
		);
		if (!targetEntry) {
			return {
				kind: "unsupported",
				reasonCode: "symlink_target_not_materialized",
			};
		}
		currentEntry = targetEntry;
	}

	return {
		kind: "unsupported",
		reasonCode: "symlink_target_not_materialized",
	};
}

async function enrichWorkingTreeEntries(params: {
	gitRoot: string;
	projectRoot: string;
	projectPrefix: string;
	rawEntries: RawDiffEntry[];
	scope?: ScanScopePolicy;
}): Promise<DiffManifestEntry[]> {
	const indexModes = await readIndexModes(params.gitRoot, params.projectPrefix);
	const result: DiffManifestEntry[] = [];
	let totalBytes = 0;
	const accountBytes = (sizeBytes: number) => {
		totalBytes += sizeBytes;
		if (totalBytes > DIFF_SCAN_LIMITS.maxTotalBytes) {
			throw new GitDiffResolutionError(
				"diff_target_too_large",
				`Diff contains more than ${DIFF_SCAN_LIMITS.maxTotalBytes} bytes.`,
				{ totalBytes },
			);
		}
	};
	for (const entry of params.rawEntries) {
		if (entry.status === "deleted") {
			result.push(baseDeletedEntry(entry, params.scope));
			continue;
		}
		if (entry.status === "unmerged") {
			result.push({
				...baseEntry(entry, params.scope),
				binary: false,
				disposition: "unsupported",
				reasonCode: "unmerged_path",
			});
			continue;
		}
		const gitPath = fromProjectPath(entry.path, params.projectPrefix);
		if (indexModes.get(gitPath) === "160000") {
			result.push({
				...baseEntry(entry, params.scope),
				status: "gitlink",
				binary: false,
				disposition: "unsupported",
				reasonCode: "gitlink_not_materialized",
			});
			continue;
		}
		const absolutePath = path.resolve(params.projectRoot, entry.path);
		if (!isInside(absolutePath, params.projectRoot)) {
			throw new GitDiffResolutionError(
				"invalid_diff_path",
				"Resolved diff path escaped the project root.",
			);
		}
		const stat = await fs.lstat(absolutePath).catch(() => null);
		if (!stat) {
			result.push(
				unsupportedEntry(entry, params.scope, "path_not_materialized"),
			);
			continue;
		}
		if (stat.isSymbolicLink()) {
			const realPath = await fs.realpath(absolutePath).catch(() => null);
			if (!realPath) {
				result.push(
					unsupportedEntry(
						entry,
						params.scope,
						"symlink_target_not_materialized",
					),
				);
				continue;
			}
			if (!isInside(realPath, params.projectRoot)) {
				accountBytes(stat.size);
				result.push({
					...baseEntry(entry, params.scope),
					sizeBytes: stat.size,
					binary: false,
					disposition: "unsupported",
					reasonCode: "symlink_escape",
				});
				continue;
			}
			const targetStat = await fs.stat(absolutePath).catch(() => null);
			if (!targetStat?.isFile()) {
				result.push(
					unsupportedEntry(entry, params.scope, "unsupported_file_type"),
				);
				continue;
			}
			accountBytes(targetStat.size);
			const targetRelativePath = normalizeProjectPrefix(
				path.relative(params.projectRoot, realPath),
			);
			if (!matchesScopePath(targetRelativePath, params.scope)) {
				result.push(excludedEntry(entry, params.scope, targetStat.size));
				continue;
			}
			if (targetStat.size > DIFF_SCAN_LIMITS.maxSingleFileBytes) {
				result.push({
					...baseEntry(entry, params.scope),
					sizeBytes: targetStat.size,
					binary: false,
					disposition: "too_large",
					reasonCode: "file_too_large",
				});
				continue;
			}
			result.push(
				contentEntry(entry, params.scope, await fs.readFile(absolutePath)),
			);
			continue;
		}
		if (!stat.isFile()) {
			result.push(
				unsupportedEntry(entry, params.scope, "unsupported_file_type"),
			);
			continue;
		}
		accountBytes(stat.size);
		if (stat.size > DIFF_SCAN_LIMITS.maxSingleFileBytes) {
			result.push({
				...baseEntry(entry, params.scope),
				sizeBytes: stat.size,
				binary: false,
				disposition: "too_large",
				reasonCode: "file_too_large",
			});
			continue;
		}
		result.push(
			contentEntry(entry, params.scope, await fs.readFile(absolutePath)),
		);
	}
	return result;
}

async function readTreeEntries(
	gitRoot: string,
	headSha: string,
	projectPrefix: string,
): Promise<Map<string, TreeEntry>> {
	const output = (
		await runGitCommand({
			cwd: gitRoot,
			args: [
				"ls-tree",
				"-r",
				"-z",
				"-l",
				headSha,
				"--",
				...pathspec(projectPrefix),
			],
		})
	).stdout;
	const result = new Map<string, TreeEntry>();
	for (const token of splitNul(output)) {
		const tab = token.indexOf("\t");
		if (tab < 0) continue;
		const [mode, type, objectId, rawSize] = token
			.slice(0, tab)
			.trim()
			.split(/\s+/);
		result.set(token.slice(tab + 1), {
			mode,
			type,
			objectId,
			size: rawSize === "-" ? null : Number.parseInt(rawSize, 10),
		});
	}
	return result;
}

async function readIndexModes(
	gitRoot: string,
	projectPrefix: string,
): Promise<Map<string, string>> {
	const output = (
		await runGitCommand({
			cwd: gitRoot,
			args: ["ls-files", "--stage", "-z", "--", ...pathspec(projectPrefix)],
		})
	).stdout;
	const result = new Map<string, string>();
	for (const token of splitNul(output)) {
		const tab = token.indexOf("\t");
		if (tab < 0) continue;
		const [mode] = token.slice(0, tab).split(/\s+/);
		result.set(token.slice(tab + 1), mode);
	}
	return result;
}

function contentEntry(
	entry: RawDiffEntry,
	scope: ScanScopePolicy | undefined,
	content: Buffer,
): DiffManifestEntry {
	const scoped = matchesScopePath(entry.path, scope);
	const binary = content.subarray(0, 8_192).includes(0);
	return {
		...baseEntry(entry, scope),
		contentSha256: crypto.createHash("sha256").update(content).digest("hex"),
		sizeBytes: content.length,
		binary,
		disposition: !scoped ? "excluded" : binary ? "unsupported" : "scan",
		reasonCode: !scoped
			? "profile_excluded"
			: binary
				? "binary_not_supported"
				: null,
	};
}

function baseEntry(
	entry: RawDiffEntry,
	scope: ScanScopePolicy | undefined,
): Pick<DiffManifestEntry, "status" | "path" | "oldPath" | "inProfileScope"> {
	return {
		status: entry.status,
		path: entry.path,
		...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
		inProfileScope: matchesScopePath(entry.path, scope),
	};
}

function baseDeletedEntry(
	entry: RawDiffEntry,
	scope: ScanScopePolicy | undefined,
): DiffManifestEntry {
	return {
		...baseEntry(entry, scope),
		binary: false,
		disposition: "deleted",
		reasonCode: "deleted_path",
	};
}

function excludedEntry(
	entry: RawDiffEntry,
	scope: ScanScopePolicy | undefined,
	sizeBytes: number | undefined,
): DiffManifestEntry {
	return {
		...baseEntry(entry, scope),
		...(sizeBytes === undefined ? {} : { sizeBytes }),
		binary: false,
		disposition: "excluded",
		reasonCode: "profile_excluded",
	};
}

function unsupportedEntry(
	entry: RawDiffEntry,
	scope: ScanScopePolicy | undefined,
	reasonCode: DiffCoverageReasonCode = "unsupported_file_type",
): DiffManifestEntry {
	return {
		...baseEntry(entry, scope),
		binary: false,
		disposition: "unsupported",
		reasonCode,
	};
}

function splitNul(output: Buffer): string[] {
	let decoded: string;
	try {
		decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
	} catch {
		throw new GitDiffResolutionError(
			"invalid_diff_path",
			"Git returned a path that is not valid UTF-8.",
		);
	}
	return decoded.split("\0").filter((token) => token.length > 0);
}

function toProjectPath(gitPath: string, projectPrefix: string): string {
	const normalizedGitPath = normalizeRelativePath(gitPath);
	if (!projectPrefix) return normalizedGitPath;
	if (
		normalizedGitPath !== projectPrefix &&
		!normalizedGitPath.startsWith(`${projectPrefix}/`)
	) {
		throw new GitDiffResolutionError(
			"invalid_diff_path",
			"Git returned a path outside the project prefix.",
		);
	}
	return normalizeRelativePath(
		normalizedGitPath.slice(projectPrefix.length).replace(/^\//, ""),
	);
}

function fromProjectPath(projectPath: string, projectPrefix: string): string {
	return projectPrefix
		? `${projectPrefix}/${normalizeRelativePath(projectPath)}`
		: normalizeRelativePath(projectPath);
}

function normalizeProjectPrefix(value: string): string {
	if (!value || value === ".") return "";
	return value
		.split(path.sep)
		.join("/")
		.replace(/^\.\/|\/$/g, "");
}

function normalizeRelativePath(value: string): string {
	const normalized = (
		process.platform === "win32" ? value.replaceAll("\\", "/") : value
	).replace(/^\.\/|\/$/g, "");
	if (
		!normalized ||
		normalized.includes("\0") ||
		path.posix.isAbsolute(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new GitDiffResolutionError(
			"invalid_diff_path",
			"Git returned an invalid relative path.",
		);
	}
	return normalized;
}

function symlinkTargetEscapesProject(
	entryPath: string,
	linkTarget: string,
): boolean {
	if (path.posix.isAbsolute(linkTarget) || path.win32.isAbsolute(linkTarget)) {
		return true;
	}
	const resolved = path.posix.normalize(
		path.posix.join(path.posix.dirname(entryPath), linkTarget),
	);
	return resolved === ".." || resolved.startsWith("../");
}

function pathspec(projectPrefix: string): string[] {
	return projectPrefix ? [`:(top,literal)${projectPrefix}`] : [];
}

function isInside(candidate: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function isGitPathInsideProject(
	gitPath: string,
	projectPrefix: string,
): boolean {
	const normalized = normalizeRelativePath(gitPath);
	return (
		!projectPrefix ||
		normalized === projectPrefix ||
		normalized.startsWith(`${projectPrefix}/`)
	);
}

function dedupeRawEntries(entries: RawDiffEntry[]): RawDiffEntry[] {
	const byPath = new Map<string, RawDiffEntry>();
	for (const entry of entries) byPath.set(entry.path, entry);
	return [...byPath.values()].sort(compareRawEntries);
}

function sortEntries(entries: DiffManifestEntry[]): DiffManifestEntry[] {
	return [...entries].sort((left, right) => {
		const pathOrder = left.path.localeCompare(right.path);
		if (pathOrder !== 0) return pathOrder;
		const oldPathOrder = (left.oldPath ?? "").localeCompare(
			right.oldPath ?? "",
		);
		if (oldPathOrder !== 0) return oldPathOrder;
		return left.status.localeCompare(right.status);
	});
}

function compareRawEntries(left: RawDiffEntry, right: RawDiffEntry): number {
	const pathOrder = left.path.localeCompare(right.path);
	if (pathOrder !== 0) return pathOrder;
	return (left.oldPath ?? "").localeCompare(right.oldPath ?? "");
}

export function mapGitError(error: unknown): GitDiffResolutionError {
	if (error instanceof GitDiffResolutionError) return error;
	if (error instanceof GitCommandError) {
		return new GitDiffResolutionError(
			"snapshot_materialization_failed",
			error.message,
			{ exitCode: error.exitCode },
		);
	}
	return new GitDiffResolutionError(
		"snapshot_materialization_failed",
		error instanceof Error ? error.message : String(error),
	);
}
