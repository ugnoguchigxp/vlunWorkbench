import fs from "node:fs/promises";
import path from "node:path";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type {
	DiffManifestEntry,
	ScanTarget,
} from "../../../shared/schemas/scan-target.schema";
import { runGitCommand, runGitText } from "./git-command";
import {
	enrichCommittedEntries,
	enrichWorkingTreeEntries,
} from "./git-diff-content-resolver";
import {
	dedupeRawEntries,
	normalizeProjectPrefix,
	parseNameStatus,
	pathspec,
	sortEntries,
	splitNul,
	toProjectPath,
} from "./git-diff-entry-utils";
import {
	DIFF_SCAN_LIMITS,
	GitDiffResolutionError,
	type RawDiffEntry,
} from "./git-diff-types";

export { DIFF_SCAN_LIMITS, GitDiffResolutionError } from "./git-diff-types";

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

export { mapGitError } from "./git-diff-entry-utils";
