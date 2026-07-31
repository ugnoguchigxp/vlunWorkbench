import crypto from "node:crypto";
import path from "node:path";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import type {
	DiffCoverageReasonCode,
	DiffManifestEntry,
	DiffPathStatus,
} from "../../../shared/schemas/scan-target.schema";
import { GitCommandError } from "./git-command";
import { GitDiffResolutionError, type RawDiffEntry } from "./git-diff-types";
import { matchesScopePath } from "./target-scope";

export function parseNameStatus(
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

export function mapStatus(status: string): DiffPathStatus {
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

export function contentEntry(
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

export function baseEntry(
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

export function baseDeletedEntry(
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

export function excludedEntry(
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

export function unsupportedEntry(
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

export function splitNul(output: Buffer): string[] {
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

export function toProjectPath(gitPath: string, projectPrefix: string): string {
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

export function fromProjectPath(
	projectPath: string,
	projectPrefix: string,
): string {
	return projectPrefix
		? `${projectPrefix}/${normalizeRelativePath(projectPath)}`
		: normalizeRelativePath(projectPath);
}

export function normalizeProjectPrefix(value: string): string {
	if (!value || value === ".") return "";
	return value
		.split(path.sep)
		.join("/")
		.replace(/^\.\/|\/$/g, "");
}

export function normalizeRelativePath(value: string): string {
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

export function symlinkTargetEscapesProject(
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

export function pathspec(projectPrefix: string): string[] {
	return projectPrefix ? [`:(top,literal)${projectPrefix}`] : [];
}

export function isInside(candidate: string, root: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

export function isGitPathInsideProject(
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

export function dedupeRawEntries(entries: RawDiffEntry[]): RawDiffEntry[] {
	const byPath = new Map<string, RawDiffEntry>();
	for (const entry of entries) byPath.set(entry.path, entry);
	return [...byPath.values()].sort(compareRawEntries);
}

export function sortEntries(entries: DiffManifestEntry[]): DiffManifestEntry[] {
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

export function compareRawEntries(
	left: RawDiffEntry,
	right: RawDiffEntry,
): number {
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
