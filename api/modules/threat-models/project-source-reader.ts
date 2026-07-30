import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { SourceInput } from "./endpoint-extractors";

const EXTENSIONS = new Set([
	".js",
	".jsx",
	".ts",
	".tsx",
	".py",
	".java",
	".go",
]);
const EXCLUDED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"vendor",
	"dist",
	"build",
	"coverage",
	"artifacts",
]);

export async function readProjectModelSources(
	projectRoot: string,
	options: {
		maxFiles?: number;
		maxFileBytes?: number;
		maxTotalBytes?: number;
		maxEntries?: number;
		maxDepth?: number;
	} = {},
): Promise<SourceInput[]> {
	const root = await realpath(projectRoot);
	const maxFiles = positiveLimit(options.maxFiles ?? 2_000);
	const maxFileBytes = positiveLimit(options.maxFileBytes ?? 2 * 1024 * 1024);
	const maxTotalBytes = positiveLimit(
		options.maxTotalBytes ?? 20 * 1024 * 1024,
	);
	const maxEntries = positiveLimit(options.maxEntries ?? 100_000);
	const maxDepth = positiveLimit(options.maxDepth ?? 64);
	const output: SourceInput[] = [];
	let totalBytes = 0;
	let visitedEntries = 0;
	await walk(root, 0);
	return output.sort((left, right) => left.path.localeCompare(right.path));

	async function walk(directory: string, depth: number): Promise<void> {
		if (depth > maxDepth) throw new Error("application_model_depth_limit");
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (++visitedEntries > maxEntries)
				throw new Error("application_model_entry_limit");
			if (entry.isSymbolicLink()) continue;
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRECTORIES.has(entry.name))
					await walk(entryPath, depth + 1);
				continue;
			}
			if (
				!entry.isFile() ||
				!EXTENSIONS.has(path.extname(entry.name).toLowerCase())
			)
				continue;
			if (output.length >= maxFiles)
				throw new Error("application_model_file_limit");
			const fileStat = await stat(entryPath);
			if (fileStat.size > maxFileBytes) continue;
			totalBytes += fileStat.size;
			if (totalBytes > maxTotalBytes)
				throw new Error("application_model_total_size_limit");
			const relative = path.relative(root, entryPath);
			if (relative.startsWith("..") || path.isAbsolute(relative))
				throw new Error("application_model_path_escape");
			output.push({
				path: relative.split(path.sep).join("/"),
				content: await readFile(entryPath, "utf8"),
			});
		}
	}
}

function positiveLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error("application_model_limit_invalid");
	return value;
}
