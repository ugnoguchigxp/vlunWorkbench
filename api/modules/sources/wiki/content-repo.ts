import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import {
	categoryFromPageRelativePath,
	DEFAULT_WIKI_CATEGORY,
} from "./category";
import { sanitizeMarkdownBody, sanitizePlainText } from "./sanitize";
import { assertSafeSlug, filePathToSlug } from "./slug";

export {
	commitDeleteChange,
	commitFileChange,
	commitPathsChange,
	ensureGitRepo,
	getGitSummary,
	getPageDiff,
	getPageHistory,
} from "./content-git-repo";
export type { GitSummary } from "./content-git-repo";

export type PageTreeItem = {
	slug: string;
	title: string;
	path: string;
	updatedAt: Date;
};

export type FolderTreeItem = {
	path: string;
};

export type MovedPage = {
	from: string;
	to: string;
};

export type PageDocument = {
	slug: string;
	title: string;
	body: string;
	path: string;
	meta: Record<string, unknown>;
};

const pagesDirectory = (contentRoot: string) =>
	path.resolve(contentRoot, "pages");

const normalizePosixPath = (targetPath: string): string =>
	targetPath.split(path.sep).join("/");

const isNotFoundError = (error: unknown): boolean => {
	if (!(error instanceof Error) || !("code" in error)) {
		return false;
	}
	return error.code === "ENOENT" || error.code === "ENOTDIR";
};

const assertInsidePages = (
	contentRoot: string,
	relativePath: string,
): string => {
	const pagesRoot = pagesDirectory(contentRoot);
	const safeRelative = relativePath.replace(/^\/+/, "");
	const absolute = path.resolve(pagesRoot, safeRelative);
	const isInside =
		absolute === pagesRoot || absolute.startsWith(`${pagesRoot}${path.sep}`);
	if (!isInside) {
		throw new Error("Invalid page path");
	}
	return absolute;
};

const assertSafeFolderPath = (folderPath: string): string => {
	const safe = assertSafeSlug(folderPath);
	if (safe === "") {
		throw new Error("Invalid folder path");
	}
	return safe;
};

export const ensureContentRoot = async (contentRoot: string): Promise<void> => {
	const pagesRoot = pagesDirectory(contentRoot);
	await fs.mkdir(pagesRoot, { recursive: true });
	await fs.mkdir(path.resolve(contentRoot, "wiki"), { recursive: true });
	const categoryRoot = path.resolve(pagesRoot, DEFAULT_WIKI_CATEGORY);
	await fs.mkdir(categoryRoot, { recursive: true });
	const homePath = path.resolve(categoryRoot, "index.md");
	const legacyHomePath = path.resolve(pagesRoot, "index.md");
	let hasCategoryHome = false;
	try {
		await fs.access(homePath);
		hasCategoryHome = true;
	} catch {
		try {
			await fs.access(legacyHomePath);
			await fs.rename(legacyHomePath, homePath);
			hasCategoryHome = true;
		} catch {
			// ignore when legacy file does not exist
		}
	}
	if (!hasCategoryHome) {
		await fs.writeFile(
			homePath,
			"# Tech Home\n\nWelcome to wiki-knowledge.\n",
			"utf8",
		);
	}
};

const readMarkdownFiles = async (
	root: string,
): Promise<Array<{ filePath: string; updatedAt: Date }>> => {
	const entries = await fs.readdir(root, { withFileTypes: true });
	const results: Array<{ filePath: string; updatedAt: Date }> = [];
	for (const entry of entries) {
		const fullPath = path.resolve(root, entry.name);
		if (entry.isDirectory()) {
			const nested = await readMarkdownFiles(fullPath);
			results.push(...nested);
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			const stat = await fs.stat(fullPath);
			results.push({ filePath: fullPath, updatedAt: stat.mtime });
		}
	}
	return results;
};

const readFolderPaths = async (
	root: string,
	base = root,
): Promise<string[]> => {
	const entries = await fs.readdir(root, { withFileTypes: true });
	const results: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const fullPath = path.resolve(root, entry.name);
		const relativePath = normalizePosixPath(path.relative(base, fullPath));
		results.push(relativePath);
		results.push(...(await readFolderPaths(fullPath, base)));
	}
	return results;
};

export const listPages = async (
	contentRoot: string,
): Promise<PageTreeItem[]> => {
	const pagesRoot = pagesDirectory(contentRoot);
	const files = await readMarkdownFiles(pagesRoot);
	const items: PageTreeItem[] = files.map((file) => {
		const relativePath = path.relative(pagesRoot, file.filePath);
		const slug = filePathToSlug(relativePath);
		return {
			slug,
			title: slug || "Home",
			path: normalizePosixPath(relativePath),
			updatedAt: file.updatedAt,
		};
	});
	return items
		.filter((item) => categoryFromPageRelativePath(item.path) !== null)
		.sort((a, b) => a.slug.localeCompare(b.slug));
};

export const listFolders = async (
	contentRoot: string,
): Promise<FolderTreeItem[]> => {
	const folders = await readFolderPaths(pagesDirectory(contentRoot));
	return folders
		.map((folderPath) => ({ path: folderPath }))
		.sort((a, b) => a.path.localeCompare(b.path));
};

const resolveCandidateRelativePaths = (slug: string): string[] => {
	const safe = assertSafeSlug(slug);
	if (safe === "") {
		return [];
	}
	if (safe.includes("/")) {
		return [`${safe}.md`, path.join(safe, "index.md")];
	}
	return [path.join(safe, "index.md"), `${safe}.md`];
};

function firstMarkdownHeading(body: string): string | null {
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("#")) continue;
		const title = trimmed.replace(/^#+\s*/, "").trim();
		if (title) return title;
	}
	return null;
}

const toMetaRecord = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return { ...(value as Record<string, unknown>) };
};

export const readPage = async (
	contentRoot: string,
	slug: string,
): Promise<PageDocument | null> => {
	const candidates = resolveCandidateRelativePaths(slug);
	for (const candidate of candidates) {
		const absolute = assertInsidePages(contentRoot, candidate);
		try {
			const raw = await fs.readFile(absolute, "utf8");
			const parsed = matter(raw);
			const relativePath = path.relative(pagesDirectory(contentRoot), absolute);
			const normalizedPath = normalizePosixPath(relativePath);
			if (categoryFromPageRelativePath(normalizedPath) === null) {
				continue;
			}
			const normalizedSlug = filePathToSlug(normalizedPath);
			const meta = toMetaRecord(parsed.data);
			const metaTitle = typeof meta.title === "string" ? meta.title.trim() : "";
			const title =
				metaTitle ||
				firstMarkdownHeading(parsed.content) ||
				normalizedSlug ||
				"Home";
			return {
				slug: normalizedSlug,
				title,
				body: parsed.content,
				path: normalizedPath,
				meta,
			};
		} catch (error) {
			if (!isNotFoundError(error)) {
				throw error;
			}
		}
	}
	return null;
};

const serializeMarkdown = (
	title: string,
	body: string,
	meta: Record<string, unknown>,
): string => {
	const mergedMeta: Record<string, unknown> = {
		...meta,
		title: sanitizePlainText(title),
	};
	const sanitizedBody = sanitizeMarkdownBody(body);
	return matter.stringify(
		sanitizedBody.endsWith("\n") ? sanitizedBody : `${sanitizedBody}\n`,
		mergedMeta,
	);
};

const resolveWritePath = (
	contentRoot: string,
	slug: string,
	relativePath?: string,
): string => {
	const safe = assertSafeSlug(slug);
	if (safe === "") {
		throw new Error("Top-level page is not allowed");
	}
	if (relativePath) {
		const normalizedRelativePath = normalizePosixPath(relativePath);
		if (
			!normalizedRelativePath.endsWith(".md") ||
			filePathToSlug(normalizedRelativePath) !== safe
		) {
			throw new Error("Existing page path does not match slug");
		}
		return assertInsidePages(contentRoot, normalizedRelativePath);
	}
	const relative = safe.includes("/") ? `${safe}.md` : `${safe}/index.md`;
	return assertInsidePages(contentRoot, relative);
};

export const writePage = async (
	contentRoot: string,
	slug: string,
	title: string,
	body: string,
	meta: Record<string, unknown>,
	options: { relativePath?: string } = {},
): Promise<{ path: string; hash: string; content: string }> => {
	const targetPath = resolveWritePath(contentRoot, slug, options.relativePath);
	await fs.mkdir(path.dirname(targetPath), { recursive: true });
	const output = serializeMarkdown(title, body, meta);
	await fs.writeFile(targetPath, output, "utf8");
	return {
		path: targetPath,
		hash: crypto.createHash("sha256").update(output).digest("hex"),
		content: output,
	};
};

const removeEmptyParentDirectories = async (
	contentRoot: string,
	removedFilePath: string,
): Promise<void> => {
	const pagesRoot = pagesDirectory(contentRoot);
	let currentDir = path.dirname(removedFilePath);
	while (
		currentDir !== pagesRoot &&
		currentDir.startsWith(`${pagesRoot}${path.sep}`)
	) {
		try {
			const entries = await fs.readdir(currentDir);
			if (entries.length > 0) return;
			await fs.rmdir(currentDir);
			currentDir = path.dirname(currentDir);
		} catch {
			return;
		}
	}
};

export const deletePage = async (
	contentRoot: string,
	slug: string,
): Promise<string> => {
	const candidates = resolveCandidateRelativePaths(slug).map((candidate) =>
		assertInsidePages(contentRoot, candidate),
	);
	for (const candidate of candidates) {
		try {
			await fs.rm(candidate);
			await removeEmptyParentDirectories(contentRoot, candidate);
			return candidate;
		} catch (error) {
			if (!isNotFoundError(error)) {
				throw error;
			}
		}
	}
	throw new Error("Page not found");
};

export const createFolder = async (
	contentRoot: string,
	folderPath: string,
): Promise<{ path: string; keepFilePath: string }> => {
	const safe = assertSafeFolderPath(folderPath);
	const folderAbsolutePath = assertInsidePages(contentRoot, safe);
	try {
		const stat = await fs.stat(folderAbsolutePath);
		if (stat.isDirectory()) {
			throw new Error("Folder already exists");
		}
		throw new Error("Folder path conflicts with a file");
	} catch (error) {
		if (!isNotFoundError(error)) {
			throw error;
		}
	}
	await fs.mkdir(folderAbsolutePath, { recursive: true });
	const keepFilePath = path.join(folderAbsolutePath, ".gitkeep");
	await fs.writeFile(keepFilePath, "", "utf8");
	return { path: safe, keepFilePath };
};

const listPagesUnderFolder = async (
	contentRoot: string,
	folderPath: string,
): Promise<PageTreeItem[]> => {
	const safe = assertSafeFolderPath(folderPath);
	const pages = await listPages(contentRoot);
	return pages.filter((page) => page.path.startsWith(`${safe}/`));
};

export const deleteFolder = async (
	contentRoot: string,
	folderPath: string,
): Promise<{ path: string; absolutePath: string; deletedSlugs: string[] }> => {
	const safe = assertSafeFolderPath(folderPath);
	const folderAbsolutePath = assertInsidePages(contentRoot, safe);
	const stat = await fs.stat(folderAbsolutePath);
	if (!stat.isDirectory()) {
		throw new Error("Folder not found");
	}
	const deletedSlugs = (await listPagesUnderFolder(contentRoot, safe)).map(
		(page) => page.slug,
	);
	await fs.rm(folderAbsolutePath, { recursive: true });
	await removeEmptyParentDirectories(contentRoot, folderAbsolutePath);
	return { path: safe, absolutePath: folderAbsolutePath, deletedSlugs };
};

export const renameFolder = async (
	contentRoot: string,
	folderPath: string,
	targetFolderPath: string,
): Promise<{
	path: string;
	from: string;
	oldAbsolutePath: string;
	newAbsolutePath: string;
	movedPages: MovedPage[];
}> => {
	const source = assertSafeFolderPath(folderPath);
	const target = assertSafeFolderPath(targetFolderPath);
	if (source === target) {
		throw new Error("Folder path is unchanged");
	}
	if (target.startsWith(`${source}/`)) {
		throw new Error("Cannot move a folder into itself");
	}
	const oldAbsolutePath = assertInsidePages(contentRoot, source);
	const newAbsolutePath = assertInsidePages(contentRoot, target);
	const oldStat = await fs.stat(oldAbsolutePath);
	if (!oldStat.isDirectory()) {
		throw new Error("Folder not found");
	}
	try {
		await fs.stat(newAbsolutePath);
		throw new Error("Folder already exists");
	} catch (error) {
		if (!isNotFoundError(error)) {
			throw error;
		}
	}
	const movedPages = (await listPagesUnderFolder(contentRoot, source)).map(
		(page) => {
			const suffix = page.path.slice(source.length + 1);
			const targetPath = path.posix.join(target, suffix);
			return { from: page.slug, to: filePathToSlug(targetPath) };
		},
	);
	await fs.mkdir(path.dirname(newAbsolutePath), { recursive: true });
	await fs.rename(oldAbsolutePath, newAbsolutePath);
	await removeEmptyParentDirectories(contentRoot, oldAbsolutePath);
	return {
		path: target,
		from: source,
		oldAbsolutePath,
		newAbsolutePath,
		movedPages,
	};
};
