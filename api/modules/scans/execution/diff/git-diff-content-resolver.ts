import fs from "node:fs/promises";
import path from "node:path";
import type { ScanScopePolicy } from "../../../../../shared/schemas/scan-profile.schema";
import type {
	DiffCoverageReasonCode,
	DiffManifestEntry,
} from "../../../../../shared/schemas/scan-target.schema";
import { runGitCommand } from "./git-command";
import {
	baseDeletedEntry,
	baseEntry,
	contentEntry,
	excludedEntry,
	fromProjectPath,
	isInside,
	normalizeProjectPrefix,
	pathspec,
	splitNul,
	symlinkTargetEscapesProject,
	unsupportedEntry,
} from "./git-diff-entry-utils";
import {
	DIFF_SCAN_LIMITS,
	GitDiffResolutionError,
	type RawDiffEntry,
	type TreeEntry,
} from "./git-diff-types";
import { matchesScopePath } from "../../target-scope";

export async function enrichCommittedEntries(params: {
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

export async function enrichWorkingTreeEntries(params: {
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
