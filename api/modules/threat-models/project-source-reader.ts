import { readFile, readdir, realpath, stat } from "node:fs/promises";
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
	} = {},
): Promise<SourceInput[]> {
	const root = await realpath(projectRoot);
	const maxFiles = options.maxFiles ?? 2_000;
	const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
	const maxTotalBytes = options.maxTotalBytes ?? 20 * 1024 * 1024;
	const output: SourceInput[] = [];
	let totalBytes = 0;
	await walk(root);
	return output.sort((left, right) => left.path.localeCompare(right.path));

	async function walk(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isSymbolicLink()) continue;
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRECTORIES.has(entry.name)) await walk(entryPath);
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
