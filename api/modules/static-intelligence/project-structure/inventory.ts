import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
	ProjectStructureCoverage,
	ProjectStructureDiagnostic,
	ProjectStructureInventoryEntry,
	ProjectStructureInventoryKind,
} from "../../../../shared/schemas/project-structure.schema";
import { structureDiagnostic } from "./diagnostics";

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

export type ProjectInventoryEntry = ProjectStructureInventoryEntry & {
	absolutePath: string;
};

export type ProjectInventory = {
	version: "inventory-v2";
	rootPath: string;
	rootRef: string;
	entries: ProjectInventoryEntry[];
	coverage: ProjectStructureCoverage;
	diagnostics: ProjectStructureDiagnostic[];
	structureInputHash: string;
};

export type BuildProjectInventoryInput = {
	projectPath: string;
	maxFiles?: number;
	maxHashBytes?: number;
};

export async function buildProjectInventory(
	input: BuildProjectInventoryInput,
): Promise<ProjectInventory> {
	const maxFiles = input.maxFiles ?? 20_000;
	if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 20_000) {
		throw new Error("maxFiles must be an integer between 1 and 20000.");
	}
	const maxHashBytes = input.maxHashBytes ?? 2 * 1024 * 1024;
	if (!Number.isInteger(maxHashBytes) || maxHashBytes < 1) {
		throw new Error("maxHashBytes must be a positive integer.");
	}

	const rootPath = await resolveProjectRoot(input.projectPath);
	const projectIgnorePatterns = await loadProjectIgnorePatterns(rootPath);
	const gitIncludedPaths = await loadGitIncludedPaths(rootPath);
	const entries: ProjectInventoryEntry[] = [];
	const diagnostics: ProjectStructureDiagnostic[] = [];
	const excludedByReason = new Map<string, number>();
	const visitedDirectories = new Set<string>();
	const visitedFiles = new Set<string>();
	let discoveredFileCount = 0;
	let totalIncludedBytes = 0;
	let budgetHit = false;

	const exclude = (reason: string) => {
		excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
	};

	const walk = async (logicalDirectory: string, realDirectory: string) => {
		if (budgetHit) return;
		if (visitedDirectories.has(realDirectory)) return;
		visitedDirectories.add(realDirectory);
		const directoryPath = relativePosix(rootPath, logicalDirectory);
		const directoryEntries = await fs
			.readdir(realDirectory, { withFileTypes: true })
			.catch((_error) => {
				diagnostics.push(
					structureDiagnostic({
						code: "inventory_directory_unreadable",
						scope: "inventory",
						impact: "degraded",
						path: directoryPath || undefined,
						count: 1,
					}),
				);
				return null;
			});
		if (!directoryEntries) return;
		directoryEntries.sort((left, right) => left.name.localeCompare(right.name));

		for (const directoryEntry of directoryEntries) {
			if (budgetHit) return;
			const logicalPath = path.join(logicalDirectory, directoryEntry.name);
			const relativePath = relativePosix(rootPath, logicalPath);
			if (
				matchesProjectIgnore(
					relativePath,
					directoryEntry.isDirectory(),
					projectIgnorePatterns,
				)
			) {
				exclude("project_ignore");
				continue;
			}
			if (isIgnoredDirectory(directoryEntry.name, relativePath)) {
				exclude(`ignored_directory:${directoryEntry.name}`);
				continue;
			}

			let realPath: string;
			try {
				realPath = await fs.realpath(logicalPath);
			} catch {
				diagnostics.push(
					structureDiagnostic({
						code: directoryEntry.isDirectory()
							? "inventory_directory_unreadable"
							: "inventory_path_unresolvable",
						scope: "inventory",
						impact: "degraded",
						path: relativePath,
					}),
				);
				continue;
			}
			if (!isPathInside(rootPath, realPath)) {
				diagnostics.push(
					structureDiagnostic({
						code: "inventory_symlink_outside_root",
						scope: "inventory",
						impact: "degraded",
						path: relativePath,
					}),
				);
				continue;
			}

			let stat: Awaited<ReturnType<typeof fs.stat>>;
			try {
				stat = await fs.stat(realPath);
			} catch {
				diagnostics.push(
					structureDiagnostic({
						code: "inventory_path_unreadable",
						scope: "inventory",
						impact: "degraded",
						path: relativePath,
					}),
				);
				continue;
			}
			if (stat.isDirectory()) {
				if (isIgnoredDirectory(directoryEntry.name, relativePath)) {
					exclude(`ignored_directory:${directoryEntry.name}`);
					continue;
				}
				if (
					visitedDirectories.has(realPath) &&
					directoryEntry.isSymbolicLink()
				) {
					diagnostics.push(
						structureDiagnostic({
							code: "inventory_symlink_cycle",
							scope: "inventory",
							impact: "degraded",
							path: relativePath,
						}),
					);
					continue;
				}
				await walk(logicalPath, realPath);
				continue;
			}
			if (!stat.isFile()) continue;
			if (gitIncludedPaths && !gitIncludedPaths.has(relativePath)) {
				exclude("git_ignored");
				continue;
			}
			if (visitedFiles.has(realPath)) {
				exclude("duplicate_symlink_target");
				continue;
			}
			visitedFiles.add(realPath);

			discoveredFileCount += 1;
			if (isSecretDataPath(directoryEntry.name)) {
				exclude("secret_or_runtime_file");
				continue;
			}
			if (entries.length >= maxFiles) {
				budgetHit = true;
				diagnostics.push(
					structureDiagnostic({
						code: "inventory_file_limit_reached",
						scope: "inventory",
						impact: "degraded",
						count: maxFiles,
					}),
				);
				return;
			}

			const kind = kindForPath(relativePath);
			const hashable = kind !== "resource" && stat.size <= maxHashBytes;
			let contentHash: string | undefined;
			if (hashable) {
				try {
					contentHash = createHash("sha256")
						.update(await fs.readFile(realPath))
						.digest("hex");
				} catch {
					diagnostics.push(
						structureDiagnostic({
							code: "inventory_file_unreadable",
							scope: "inventory",
							impact: "degraded",
							path: relativePath,
						}),
					);
					continue;
				}
			}
			entries.push({
				absolutePath: realPath,
				path: relativePath,
				realPathRef: sha256Hex(relativePosix(rootPath, realPath)),
				kind,
				mediaType: mediaTypeForKind(kind),
				sizeBytes: stat.size,
				hashMode: contentHash ? "content" : "path_only",
				...(contentHash ? { contentHash } : {}),
				analyzerIds: analyzerIdsForKind(kind),
			});
			totalIncludedBytes += stat.size;
		}
	};

	await walk(rootPath, rootPath);
	entries.sort((left, right) => left.path.localeCompare(right.path));
	const coverage: ProjectStructureCoverage = {
		discoveredFileCount,
		includedFileCount: entries.length,
		analyzableFileCount: entries.filter((entry) => entry.analyzerIds.length > 0)
			.length,
		unsupportedFileCount: entries.filter(
			(entry) => entry.analyzerIds.length === 0,
		).length,
		resourceFileCount: entries.filter((entry) => entry.kind === "resource")
			.length,
		excludedFileCount: [...excludedByReason.values()].reduce(
			(total, count) => total + count,
			0,
		),
		excludedByReason: Object.fromEntries(
			[...excludedByReason.entries()].sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		unhashedFileCount: entries.filter((entry) => entry.hashMode === "path_only")
			.length,
		totalIncludedBytes,
		budgetHit,
	};
	return {
		version: "inventory-v2",
		rootPath,
		rootRef: sha256Hex(rootPath),
		entries,
		coverage,
		diagnostics: sortDiagnostics(diagnostics),
		structureInputHash: structureInputHash(entries),
	};
}

const execFileAsync = promisify(execFile);

async function loadGitIncludedPaths(
	rootPath: string,
): Promise<Set<string> | null> {
	try {
		const { stdout: topLevel } = await execFileAsync(
			"git",
			["rev-parse", "--show-toplevel"],
			{ cwd: rootPath, encoding: "utf8", maxBuffer: 1024 * 1024 },
		);
		const repositoryRoot = await fs.realpath(topLevel.trim());
		if (!isPathInside(repositoryRoot, rootPath)) return null;
		const projectPrefix = relativePosix(repositoryRoot, rootPath);
		const pathspec = projectPrefix ? `${projectPrefix}/` : ".";
		const { stdout } = await execFileAsync(
			"git",
			[
				"ls-files",
				"--cached",
				"--others",
				"--exclude-standard",
				"-z",
				"--",
				pathspec,
			],
			{ cwd: repositoryRoot, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
		);
		const prefix = projectPrefix ? `${projectPrefix}/` : "";
		return new Set(
			stdout
				.toString("utf8")
				.split("\0")
				.filter(Boolean)
				.map((entry) => entry.split(path.sep).join("/"))
				.filter((entry) => !prefix || entry.startsWith(prefix))
				.map((entry) => (prefix ? entry.slice(prefix.length) : entry))
				.filter((entry) => entry.length > 0 && entry !== "."),
		);
	} catch {
		return null;
	}
}

export function isCodeInventoryEntry(entry: ProjectInventoryEntry): boolean {
	return entry.kind === "source";
}

function kindForPath(filePath: string): ProjectStructureInventoryKind {
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

function analyzerIdsForKind(kind: ProjectStructureInventoryKind): string[] {
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

function mediaTypeForKind(kind: ProjectStructureInventoryKind): string {
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

async function resolveProjectRoot(projectPath: string): Promise<string> {
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(projectPath);
	} catch {
		throw new Error(`Project path not found: ${projectPath}`);
	}
	if (!stat.isDirectory())
		throw new Error(`Project path is not a directory: ${projectPath}`);
	return fs.realpath(projectPath);
}

function isSecretDataPath(fileName: string): boolean {
	const lower = fileName.toLowerCase();
	return (
		lower === ".env" ||
		lower.startsWith(".env.") ||
		SECRET_FILE_EXTENSIONS.has(path.extname(lower))
	);
}

function isIgnoredDirectory(name: string, relativePath: string): boolean {
	return (
		IGNORED_DIRECTORIES.has(name) ||
		(name === "artifacts" && relativePath === "artifacts")
	);
}

async function loadProjectIgnorePatterns(rootPath: string): Promise<string[]> {
	try {
		const raw = await fs.readFile(
			path.join(rootPath, ".vulnworkbenchignore"),
			"utf8",
		);
		return raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"))
			.slice(0, 256);
	} catch {
		return [];
	}
}

function matchesProjectIgnore(
	relativePath: string,
	isDirectory: boolean,
	patterns: string[],
): boolean {
	return patterns.some((pattern) => {
		const normalized = pattern.replace(/^\.\//, "").replace(/\/$/, "");
		if (!normalized) return false;
		if (!normalized.includes("*")) {
			return (
				relativePath === normalized ||
				(isDirectory && relativePath.startsWith(`${normalized}/`))
			);
		}
		const expression = `^${normalized
			.split("**")
			.map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
			.join(".*")}${isDirectory ? "(?:/.*)?" : ""}$`;
		return new RegExp(expression).test(relativePath);
	});
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPathInside(rootPath: string, childPath: string): boolean {
	const relative = path.relative(rootPath, childPath);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function relativePosix(rootPath: string, absolutePath: string): string {
	return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function structureInputHash(entries: ProjectInventoryEntry[]): string {
	const hash = createHash("sha256");
	for (const entry of entries) {
		hash.update(
			`${entry.path}\0${entry.kind}\0${entry.hashMode}\0${entry.contentHash ?? ""}\n`,
		);
	}
	return hash.digest("hex");
}

function sortDiagnostics(
	diagnostics: ProjectStructureDiagnostic[],
): ProjectStructureDiagnostic[] {
	return [...diagnostics].sort(
		(left, right) =>
			left.scope.localeCompare(right.scope) ||
			left.code.localeCompare(right.code) ||
			(left.path ?? "").localeCompare(right.path ?? ""),
	);
}
