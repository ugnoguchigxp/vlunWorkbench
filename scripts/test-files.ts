import fs from "node:fs/promises";
import path from "node:path";

const ignoredDirectoriesEverywhere = new Set([
	".git",
	".artifacts",
	".cache",
	".tmp",
	"build",
	"coverage",
	"data",
	"dist",
	"dist-web",
	"node_modules",
	"playwright-report",
	"test-results",
]);

const ignoredRootDirectories = new Set(["artifacts"]);

export const nodeVitestFiles = [
	"api/modules/dast/playwright-browser-adapter.test.ts",
	"api/modules/static-intelligence/static-intelligence-mcp-stdio.test.ts",
] as const;

async function walk(directory: string, root: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			const isRootDirectory = directory === root;
			if (
				ignoredDirectoriesEverywhere.has(entry.name) ||
				(isRootDirectory && ignoredRootDirectories.has(entry.name))
			) {
				continue;
			}
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
	return (await walk(root, root)).sort();
}

export const isVitestFile = (file: string): boolean =>
	file.startsWith("web/") ||
	file.startsWith("shared/") ||
	nodeVitestFiles.includes(file as (typeof nodeVitestFiles)[number]);
