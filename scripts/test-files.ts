import fs from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
	".git",
	".artifacts",
	".cache",
	".tmp",
	"artifacts",
	"build",
	"coverage",
	"data",
	"dist",
	"dist-web",
	"node_modules",
	"playwright-report",
	"test-results",
]);

async function walk(directory: string, root: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(absolute, root)));
			continue;
		}
		if (!entry.isFile() || !/\.test\.(?:ts|tsx)$/.test(entry.name)) continue;
		files.push(path.relative(root, absolute).split(path.sep).join("/"));
	}
	return files;
}

export async function discoverTestFiles(
	root = process.cwd(),
): Promise<string[]> {
	return (await walk(root, root)).sort((a, b) => a.localeCompare(b));
}

export const isVitestFile = (file: string): boolean =>
	file.startsWith("web/") || file.startsWith("shared/");
