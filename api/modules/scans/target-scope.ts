import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import { matchesPluginGlob } from "../project-capabilities/path-patterns";

export interface ResolvedScanScope {
	scope: ScanScopePolicy;
	includedRoots: string[];
	excludedRoots: string[];
	alwaysExcludedRoots: string[];
	symlinkEscapes: string[];
	reason: string;
}

const ALWAYS_EXCLUDED_GLOBS = [".git/**", "artifacts/**"];

const DEFAULT_SOURCE_SCOPE: ScanScopePolicy = {
	intent: "source",
	includeGlobs: ["**/*"],
	excludeGlobs: [
		"node_modules/**",
		"dist/**",
		"dist-web/**",
		"build/**",
		"coverage/**",
		"artifacts/**",
	],
	includeGenerated: false,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
};

export function withMandatoryExcludes(
	scope?: ScanScopePolicy,
): ScanScopePolicy {
	const base = scope ?? DEFAULT_SOURCE_SCOPE;
	const excludeGlobs = dedupeStrings([
		...base.excludeGlobs,
		...ALWAYS_EXCLUDED_GLOBS,
	]);
	return {
		...base,
		includeGlobs: dedupeStrings(base.includeGlobs),
		excludeGlobs,
	};
}

export async function resolveScanScope(params: {
	repoPath: string;
	scope?: ScanScopePolicy;
}): Promise<ResolvedScanScope> {
	const scope = withMandatoryExcludes(params.scope);
	const repoRoot = path.resolve(params.repoPath);
	const topLevelEntries = await readTopLevelEntries(repoRoot);
	const symlinkEscapes: string[] = [];
	const includedRoots = new Set<string>();
	const excludedRoots = new Set<string>();

	for (const entry of topLevelEntries) {
		const relativePath = toPosixPath(entry.name);
		if (entry.isSymbolicLink()) {
			const realPath = await fs
				.realpath(path.join(repoRoot, entry.name))
				.catch(() => null);
			if (!realPath || !isPathInside(realPath, repoRoot)) {
				excludedRoots.add(relativePath);
				symlinkEscapes.push(relativePath);
				continue;
			}
		}

		if (matchesAnyGlob(relativePath, scope.excludeGlobs)) {
			excludedRoots.add(relativePath);
			continue;
		}
		if (
			scope.includeGlobs.length === 0 ||
			matchesAnyGlob(relativePath, scope.includeGlobs) ||
			matchesAnyGlob(`${relativePath}/index`, scope.includeGlobs)
		) {
			includedRoots.add(relativePath);
		}
	}

	for (const root of scope.excludeGlobs.map(rootFromGlob).filter(Boolean)) {
		excludedRoots.add(root);
	}
	for (const root of scope.includeGlobs.map(rootFromGlob).filter(Boolean)) {
		if (!matchesAnyGlob(root, scope.excludeGlobs)) {
			includedRoots.add(root);
		}
	}

	return {
		scope,
		includedRoots: [...includedRoots].sort(),
		excludedRoots: [...excludedRoots].sort(),
		alwaysExcludedRoots: ALWAYS_EXCLUDED_GLOBS.map(rootFromGlob)
			.filter(Boolean)
			.sort(),
		symlinkEscapes: symlinkEscapes.sort(),
		reason: describeScope(scope),
	};
}

export function getScopeExcludeGlobs(scope?: ScanScopePolicy): string[] {
	return withMandatoryExcludes(scope).excludeGlobs;
}

export function getScopeIncludeGlobs(scope?: ScanScopePolicy): string[] {
	return withMandatoryExcludes(scope).includeGlobs;
}

export function getScopeSkipDirs(scope?: ScanScopePolicy): string[] {
	const normalizedScope = withMandatoryExcludes(scope);
	return normalizedScope.excludeGlobs
		.map(rootFromGlob)
		.filter((root) => root && !root.includes("*") && !path.extname(root))
		.sort();
}

export function matchesScopePath(
	relativePath: string,
	scope?: ScanScopePolicy,
): boolean {
	const normalizedScope = withMandatoryExcludes(scope);
	const normalizedPath = toPosixPath(relativePath);
	if (matchesAnyGlob(normalizedPath, normalizedScope.excludeGlobs)) {
		return false;
	}
	if (normalizedScope.includeGlobs.length === 0) {
		return true;
	}
	return matchesAnyGlob(normalizedPath, normalizedScope.includeGlobs);
}

export async function createScopedWorkspace(params: {
	repoPath: string;
	scope?: ScanScopePolicy;
	additionalScope?: ScanScopePolicy;
	prefix: string;
}): Promise<{ path: string; copiedFiles: number }> {
	const workspaceRoot = await fs.mkdtemp(params.prefix);
	const repoRoot = path.resolve(params.repoPath);
	let copiedFiles = 0;

	try {
		await copyScopedEntries({
			sourceRoot: repoRoot,
			currentPath: repoRoot,
			destinationRoot: workspaceRoot,
			scope: withMandatoryExcludes(params.scope),
			additionalScope: params.additionalScope
				? withMandatoryExcludes(params.additionalScope)
				: undefined,
			onFileCopied: () => {
				copiedFiles++;
			},
		});
	} catch (error) {
		try {
			await fs.rm(workspaceRoot, { recursive: true, force: true });
		} catch {
			throw new Error("scoped_workspace_cleanup_failed");
		}
		throw error;
	}

	return { path: workspaceRoot, copiedFiles };
}

export async function digestScopedFiles(params: {
	repoPath: string;
	scope?: ScanScopePolicy;
}): Promise<string> {
	return (await inspectScopedFiles(params)).digest;
}

export async function inspectScopedFiles(params: {
	repoPath: string;
	scope?: ScanScopePolicy;
}): Promise<{ digest: string; fileCount: number }> {
	const sourceRoot = await fs.realpath(params.repoPath);
	const scope = withMandatoryExcludes(params.scope);
	const hash = crypto.createHash("sha256");
	let fileCount = 0;
	const walk = async (currentPath: string): Promise<void> => {
		const entries = await fs.readdir(currentPath, { withFileTypes: true });
		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const absolute = path.join(currentPath, entry.name);
			const relative = toPosixPath(path.relative(sourceRoot, absolute));
			if (
				!relative ||
				matchesAnyGlob(relative, scope.excludeGlobs) ||
				(entry.isDirectory() &&
					matchesAnyGlob(`${relative}/__scope_probe__`, scope.excludeGlobs))
			)
				continue;
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile() || !matchesScopePath(relative, scope)) continue;
			hash.update(`f:${relative}\0`);
			hash.update(await fs.readFile(absolute));
			fileCount++;
		}
	};
	await walk(sourceRoot);
	return { digest: hash.digest("hex"), fileCount };
}

function describeScope(scope: ScanScopePolicy): string {
	switch (scope.intent) {
		case "dependency_manifest":
			return "dependency manifest scope excludes installed dependency trees";
		case "artifact":
			return "artifact scope includes generated deployable output";
		case "full_deep":
			return "full deep scope includes generated output and installed dependencies";
		default:
			return "source scope excludes generated output and installed dependencies";
	}
}

async function copyScopedEntries(params: {
	sourceRoot: string;
	currentPath: string;
	destinationRoot: string;
	scope: ScanScopePolicy;
	additionalScope?: ScanScopePolicy;
	onFileCopied: () => void;
}): Promise<void> {
	const entries = await fs.readdir(params.currentPath, { withFileTypes: true });

	for (const entry of entries) {
		const sourcePath = path.join(params.currentPath, entry.name);
		const relativePath = toPosixPath(
			path.relative(params.sourceRoot, sourcePath),
		);
		if (!relativePath) {
			continue;
		}
		if (
			matchesAnyGlob(relativePath, params.scope.excludeGlobs) ||
			(entry.isDirectory() &&
				matchesAnyGlob(
					`${relativePath}/__scope_probe__`,
					params.scope.excludeGlobs,
				)) ||
			(params.additionalScope &&
				(matchesAnyGlob(relativePath, params.additionalScope.excludeGlobs) ||
					(entry.isDirectory() &&
						matchesAnyGlob(
							`${relativePath}/__scope_probe__`,
							params.additionalScope.excludeGlobs,
						))))
		) {
			continue;
		}
		if (entry.isSymbolicLink()) {
			const realPath = await fs.realpath(sourcePath).catch(() => null);
			if (!realPath || !isPathInside(realPath, params.sourceRoot)) {
				continue;
			}
		}
		if (entry.isDirectory()) {
			await copyScopedEntries({
				...params,
				currentPath: sourcePath,
			});
			continue;
		}
		if (
			!entry.isFile() ||
			!matchesScopePath(relativePath, params.scope) ||
			(params.additionalScope &&
				!matchesScopePath(relativePath, params.additionalScope))
		) {
			continue;
		}

		const destinationPath = path.join(params.destinationRoot, relativePath);
		await fs.mkdir(path.dirname(destinationPath), { recursive: true });
		await fs.copyFile(sourcePath, destinationPath);
		params.onFileCopied();
	}
}

async function readTopLevelEntries(repoRoot: string) {
	return await fs.readdir(repoRoot, { withFileTypes: true });
}

function matchesAnyGlob(relativePath: string, globs: string[]): boolean {
	return globs.some((glob) => matchesGlob(relativePath, glob));
}

function matchesGlob(relativePath: string, glob: string): boolean {
	return matchesPluginGlob(relativePath, glob);
}

function rootFromGlob(glob: string): string {
	const normalized = toPosixPath(glob);
	const firstSegment = normalized.split("/")[0] ?? "";
	if (!firstSegment || firstSegment === "**") {
		return "";
	}
	return firstSegment;
}

function toPosixPath(value: string): string {
	return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isPathInside(childPath: string, parentPath: string): boolean {
	const relative = path.relative(
		path.resolve(parentPath),
		path.resolve(childPath),
	);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)].filter(Boolean);
}
