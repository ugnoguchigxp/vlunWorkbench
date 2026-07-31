import path from "node:path";
import type { ProjectStructureInventoryKind } from "../../../../shared/schemas/project-structure.schema";

const CODE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
]);
const STYLE_EXTENSIONS = new Set([".css"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm"]);
const MANIFEST_FILENAMES = new Set(["package.json", "pnpm-workspace.yaml"]);
const CONFIG_FILENAMES = new Set(["tsconfig.json", "jsconfig.json"]);
const IGNORED_DIRECTORIES = new Set([
	".git",
	"node_modules",
	"dist",
	"dist-web",
	"build",
	"coverage",
	".next",
	".turbo",
	".cache",
	".vite",
	"vendor",
]);
const SECRET_FILE_EXTENSIONS = new Set([
	".pem",
	".key",
	".crt",
	".p12",
	".sqlite",
	".db",
	".wal",
	".shm",
]);

export function kindForInventoryPath(
	filePath: string,
): ProjectStructureInventoryKind {
	const basename = path.posix.basename(filePath).toLowerCase();
	const extension = path.posix.extname(filePath).toLowerCase();
	if (MANIFEST_FILENAMES.has(basename)) return "manifest";
	if (
		CONFIG_FILENAMES.has(basename) ||
		/^tsconfig\.[^.]+\.json$/.test(basename) ||
		/^jsconfig\.[^.]+\.json$/.test(basename)
	)
		return "config";
	if (CODE_EXTENSIONS.has(extension)) return "source";
	if (STYLE_EXTENSIONS.has(extension)) return "style";
	if (MARKUP_EXTENSIONS.has(extension)) return "markup";
	return "resource";
}

export function analyzerIdsForInventoryKind(
	kind: ProjectStructureInventoryKind,
): string[] {
	switch (kind) {
		case "source":
			return ["typescript-javascript"];
		case "style":
			return ["css"];
		case "markup":
			return ["html"];
		case "manifest":
		case "config":
			return ["manifest-config"];
		case "resource":
			return [];
	}
}

export function mediaTypeForInventoryKind(
	kind: ProjectStructureInventoryKind,
): string {
	switch (kind) {
		case "source":
			return "text/source";
		case "style":
			return "text/css";
		case "markup":
			return "text/html";
		case "manifest":
		case "config":
			return "application/json";
		case "resource":
			return "application/octet-stream";
	}
}

export function isSecretInventoryPath(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	return (
		lower === ".env" ||
		lower.startsWith(".env.") ||
		SECRET_FILE_EXTENSIONS.has(path.extname(lower))
	);
}

export function isIgnoredInventoryDirectory(
	name: string,
	relativePath: string,
): boolean {
	return (
		IGNORED_DIRECTORIES.has(name) ||
		(name === "artifacts" && relativePath === "artifacts")
	);
}
