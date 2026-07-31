import path from "node:path";
import type { ProjectStructureInventoryKind } from "../../../../shared/schemas/project-structure.schema";
import { builtInTechnologyPluginRegistry } from "../../../plugins/builtin";
import { matchesAnyPluginGlob } from "../../project-capabilities/path-patterns";

const STYLE_EXTENSIONS = new Set([".css"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm"]);
const CONFIG_FILENAMES = new Set([
	"tsconfig.json",
	"jsconfig.json",
	"application.properties",
	"application.yml",
	"application.yaml",
]);
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
	".gradle",
	"target",
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
	if (matchesPluginDependencyInput(filePath, "primary")) return "manifest";
	if (
		matchesPluginDependencyInput(filePath, "companion") ||
		CONFIG_FILENAMES.has(basename) ||
		/^tsconfig\.[^.]+\.json$/.test(basename) ||
		/^jsconfig\.[^.]+\.json$/.test(basename)
	)
		return "config";
	if (
		builtInTechnologyPluginRegistry
			.sourceAnalyzers()
			.some((analyzer) => analyzer.extensions.includes(extension))
	)
		return "source";
	if (STYLE_EXTENSIONS.has(extension)) return "style";
	if (MARKUP_EXTENSIONS.has(extension)) return "markup";
	return "resource";
}

export function analyzerIdsForInventoryPath(
	filePath: string,
	kind: ProjectStructureInventoryKind,
): string[] {
	switch (kind) {
		case "source":
			return builtInTechnologyPluginRegistry
				.sourceAnalyzers()
				.filter((analyzer) =>
					analyzer.extensions.includes(
						path.posix.extname(filePath).toLowerCase(),
					),
				)
				.map((analyzer) => analyzer.id);
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

function matchesPluginDependencyInput(
	filePath: string,
	kind: "primary" | "companion",
): boolean {
	return builtInTechnologyPluginRegistry
		.dependencyProviders()
		.some((provider) =>
			matchesAnyPluginGlob(
				filePath,
				kind === "primary" ? provider.primaryGlobs : provider.companionGlobs,
			),
		);
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
			return "text/config";
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
