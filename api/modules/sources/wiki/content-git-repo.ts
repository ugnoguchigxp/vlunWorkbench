import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertSafeSlug } from "./slug";

const execFileAsync = promisify(execFile);
const gitInitLocks = new Map<string, Promise<void>>();

export type GitSummary = {
	branch: string;
	commit: string;
} | null;

const normalizePosixPath = (targetPath: string): string =>
	targetPath.split(path.sep).join("/");

const isNotFoundError = (error: unknown): boolean => {
	if (!(error instanceof Error) || !("code" in error)) return false;
	return error.code === "ENOENT" || error.code === "ENOTDIR";
};

const assertInsidePages = (
	contentRoot: string,
	relativePath: string,
): string => {
	const pagesRoot = path.resolve(contentRoot, "pages");
	const safeRelative = relativePath.replace(/^\/+/, "");
	const absolute = path.resolve(pagesRoot, safeRelative);
	if (
		absolute !== pagesRoot &&
		!absolute.startsWith(`${pagesRoot}${path.sep}`)
	) {
		throw new Error("Invalid page path");
	}
	return absolute;
};

const resolveCandidateRelativePaths = (slug: string): string[] => {
	const safe = assertSafeSlug(slug);
	if (safe === "") return [];
	if (safe.includes("/")) {
		return [`${safe}.md`, path.join(safe, "index.md")];
	}
	return [path.join(safe, "index.md"), `${safe}.md`];
};

const findExistingPageRelativePath = async (
	contentRoot: string,
	slug: string,
): Promise<string | null> => {
	for (const candidate of resolveCandidateRelativePaths(slug)) {
		const absolute = assertInsidePages(contentRoot, candidate);
		try {
			const stat = await fs.stat(absolute);
			if (stat.isFile()) return normalizePosixPath(candidate);
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
	}
	return null;
};

const runGit = async (
	contentRoot: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> =>
	execFileAsync("git", ["-C", contentRoot, ...args]);

const errorMessage = (error: unknown): string => {
	if (!(error instanceof Error)) return "";
	const stderr =
		"stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
	return `${error.message}\n${stderr}`.trim();
};

const hasStagedChanges = async (
	contentRoot: string,
	relativePath: string,
): Promise<boolean> => {
	try {
		await runGit(contentRoot, [
			"diff",
			"--cached",
			"--quiet",
			"--",
			relativePath,
		]);
		return false;
	} catch {
		return true;
	}
};

const hasAnyStagedChanges = async (
	contentRoot: string,
	relativePaths: string[],
): Promise<boolean> => {
	try {
		await runGit(contentRoot, [
			"diff",
			"--cached",
			"--quiet",
			"--",
			...relativePaths,
		]);
		return false;
	} catch {
		return true;
	}
};

export const ensureGitRepo = async (contentRoot: string): Promise<void> => {
	const existing = gitInitLocks.get(contentRoot);
	if (existing) {
		await existing;
		return;
	}
	const task = (async () => {
		try {
			await runGit(contentRoot, ["rev-parse", "--is-inside-work-tree"]);
			return;
		} catch {
			// Initialize below.
		}
		try {
			await runGit(contentRoot, ["init"]);
		} catch (error) {
			const message = errorMessage(error);
			if (
				!message.includes(".git/info/exclude") ||
				!message.includes("File exists")
			) {
				throw error;
			}
		}
		try {
			await runGit(contentRoot, ["checkout", "-b", "main"]);
		} catch {
			// Branch already exists.
		}
	})().finally(() => {
		gitInitLocks.delete(contentRoot);
	});
	gitInitLocks.set(contentRoot, task);
	await task;
};

export const getGitSummary = async (
	contentRoot: string,
): Promise<GitSummary> => {
	try {
		const [{ stdout: branchStdout }, { stdout: commitStdout }] =
			await Promise.all([
				execFileAsync("git", [
					"-C",
					contentRoot,
					"rev-parse",
					"--abbrev-ref",
					"HEAD",
				]),
				execFileAsync("git", [
					"-C",
					contentRoot,
					"rev-parse",
					"--short",
					"HEAD",
				]),
			]);
		return { branch: branchStdout.trim(), commit: commitStdout.trim() };
	} catch {
		return null;
	}
};

export const commitFileChange = async (
	contentRoot: string,
	absolutePath: string,
	message: string,
): Promise<string | null> => {
	const normalizedRelative = normalizePosixPath(
		path.relative(contentRoot, absolutePath),
	);
	await runGit(contentRoot, ["add", normalizedRelative]);
	try {
		await runGit(contentRoot, ["commit", "-m", message]);
	} catch (error) {
		if (await hasStagedChanges(contentRoot, normalizedRelative)) throw error;
	}
	return (await getGitSummary(contentRoot))?.commit ?? null;
};

export const commitDeleteChange = async (
	contentRoot: string,
	absolutePath: string,
	message: string,
): Promise<string | null> => {
	const normalizedRelative = normalizePosixPath(
		path.relative(contentRoot, absolutePath),
	);
	await runGit(contentRoot, ["add", "-A", normalizedRelative]);
	try {
		await runGit(contentRoot, ["commit", "-m", message]);
	} catch (error) {
		if (await hasStagedChanges(contentRoot, normalizedRelative)) throw error;
	}
	return (await getGitSummary(contentRoot))?.commit ?? null;
};

export const commitPathsChange = async (
	contentRoot: string,
	absolutePaths: string[],
	message: string,
): Promise<string | null> => {
	const normalizedRelatives = absolutePaths.map((absolutePath) =>
		normalizePosixPath(path.relative(contentRoot, absolutePath)),
	);
	await runGit(contentRoot, ["add", "-A", "--", ...normalizedRelatives]);
	try {
		await runGit(contentRoot, ["commit", "-m", message]);
	} catch (error) {
		if (await hasAnyStagedChanges(contentRoot, normalizedRelatives))
			throw error;
	}
	return (await getGitSummary(contentRoot))?.commit ?? null;
};

const resolveGitPathspecs = async (
	contentRoot: string,
	slug: string,
): Promise<string[]> => {
	const existing = await findExistingPageRelativePath(contentRoot, slug);
	if (existing) return [path.posix.join("pages", existing)];
	return resolveCandidateRelativePaths(slug).map((candidate) =>
		path.posix.join("pages", normalizePosixPath(candidate)),
	);
};

export const getPageHistory = async (
	contentRoot: string,
	slug: string,
): Promise<
	Array<{ commit: string; author: string; date: string; message: string }>
> => {
	const pathspecs = await resolveGitPathspecs(contentRoot, slug);
	try {
		const { stdout } = await runGit(contentRoot, [
			"log",
			"--pretty=format:%H\t%an\t%ad\t%s",
			"--date=iso-strict",
			"--",
			...pathspecs,
		]);
		return stdout
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => {
				const [commit, author, date, message] = line.split("\t");
				return {
					commit: commit ?? "",
					author: author ?? "",
					date: date ?? "",
					message: message ?? "",
				};
			});
	} catch {
		return [];
	}
};

export const getPageDiff = async (
	contentRoot: string,
	slug: string,
	from: string,
	to: string,
): Promise<string> => {
	const pathspecs = await resolveGitPathspecs(contentRoot, slug);
	try {
		return (await runGit(contentRoot, ["diff", from, to, "--", ...pathspecs]))
			.stdout;
	} catch {
		return "";
	}
};
