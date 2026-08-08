import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export type ProjectPathPolicyErrorCode =
	| "PROJECT_PATH_REQUIRED"
	| "PROJECT_PATH_NOT_FOUND"
	| "PROJECT_PATH_NOT_DIRECTORY"
	| "PROJECT_PATH_UNREADABLE"
	| "PROJECT_PATH_NOT_ALLOWED"
	| "PROJECT_ALLOWED_ROOT_INVALID";

export class ProjectPathPolicyError extends Error {
	constructor(
		readonly code: ProjectPathPolicyErrorCode,
		message: string,
	) {
		super(message);
		this.name = "ProjectPathPolicyError";
	}
}

export type AuthorizedProjectPath = {
	canonicalPath: string;
	allowedRoot: string;
};

export type ResolvedProjectPath = {
	canonicalPath: string;
};

function isSameOrDescendant(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

function isMissingPathError(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) return false;
	return error.code === "ENOENT" || error.code === "ENOTDIR";
}

export async function canonicalizeProjectAllowedRoots(
	roots: readonly string[],
): Promise<string[]> {
	const canonicalRoots: string[] = [];
	for (const configuredRoot of roots) {
		const absoluteRoot = path.resolve(configuredRoot);
		try {
			const canonicalRoot = await fs.realpath(absoluteRoot);
			const stat = await fs.stat(canonicalRoot);
			if (!stat.isDirectory()) {
				throw new ProjectPathPolicyError(
					"PROJECT_ALLOWED_ROOT_INVALID",
					`Configured project root is not a directory: ${configuredRoot}`,
				);
			}
			await fs.access(canonicalRoot, fsConstants.R_OK | fsConstants.X_OK);
			canonicalRoots.push(canonicalRoot);
		} catch (error) {
			if (error instanceof ProjectPathPolicyError) throw error;
			throw new ProjectPathPolicyError(
				"PROJECT_ALLOWED_ROOT_INVALID",
				`Configured project root is unavailable: ${configuredRoot}`,
			);
		}
	}
	return [...new Set(canonicalRoots)].sort((a, b) => a.localeCompare(b));
}

export async function resolveProjectPath(
	projectPath: string,
): Promise<ResolvedProjectPath> {
	const requestedPath = projectPath.trim();
	if (
		!requestedPath ||
		requestedPath.length > 4096 ||
		requestedPath.includes("\0")
	) {
		throw new ProjectPathPolicyError(
			"PROJECT_PATH_REQUIRED",
			"Project path must be a non-empty filesystem path.",
		);
	}

	const absolutePath = path.resolve(requestedPath);
	try {
		const stat = await fs.stat(absolutePath);
		if (!stat.isDirectory()) {
			throw new ProjectPathPolicyError(
				"PROJECT_PATH_NOT_DIRECTORY",
				"The requested project path is not a directory.",
			);
		}
	} catch (error) {
		if (error instanceof ProjectPathPolicyError) throw error;
		if (!isMissingPathError(error)) {
			throw new ProjectPathPolicyError(
				"PROJECT_PATH_UNREADABLE",
				"The requested project path is not readable.",
			);
		}
		throw new ProjectPathPolicyError(
			"PROJECT_PATH_NOT_FOUND",
			"The requested project path does not exist.",
		);
	}

	let canonicalPath: string;
	try {
		canonicalPath = await fs.realpath(absolutePath);
		const canonicalStat = await fs.stat(canonicalPath);
		if (!canonicalStat.isDirectory()) {
			throw new ProjectPathPolicyError(
				"PROJECT_PATH_NOT_DIRECTORY",
				"The requested project path is not a directory.",
			);
		}
		await fs.access(canonicalPath, fsConstants.R_OK | fsConstants.X_OK);
	} catch (error) {
		if (error instanceof ProjectPathPolicyError) throw error;
		if (isMissingPathError(error)) {
			throw new ProjectPathPolicyError(
				"PROJECT_PATH_NOT_FOUND",
				"The requested project path does not exist.",
			);
		}
		throw new ProjectPathPolicyError(
			"PROJECT_PATH_UNREADABLE",
			"The requested project path is not readable.",
		);
	}

	return { canonicalPath };
}

export async function authorizeProjectPathWithinRoots(params: {
	projectPath: string;
	allowedRoots: readonly string[];
}): Promise<AuthorizedProjectPath> {
	const { canonicalPath } = await resolveProjectPath(params.projectPath);
	const canonicalRoots = await canonicalizeProjectAllowedRoots(
		params.allowedRoots,
	);
	const allowedRoot = canonicalRoots.find((root) =>
		isSameOrDescendant(root, canonicalPath),
	);
	if (!allowedRoot) {
		throw new ProjectPathPolicyError(
			"PROJECT_PATH_NOT_ALLOWED",
			"The requested project path is outside the configured client roots.",
		);
	}

	return { canonicalPath, allowedRoot };
}
