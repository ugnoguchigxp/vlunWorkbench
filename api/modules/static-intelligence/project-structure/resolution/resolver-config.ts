import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectInventoryEntry } from "../inventory";
import type { UnresolvedStructureReference } from "../analyzers/registry";
import { relativeResolutionCandidates } from "./resolution-candidates";

type AliasRule = {
	pattern: string;
	targets: string[];
	ownerDirectory: string;
	resolutionDirectory: string;
	baseUrl: string;
};
type WorkspacePackage = { name: string; root: string; entries: string[] };
export type ResolverConfig = {
	aliases: AliasRule[];
	configDirectories: string[];
	workspacePackages: WorkspacePackage[];
};

export async function loadResolverConfig(
	entries: ProjectInventoryEntry[],
): Promise<ResolverConfig> {
	const aliases: AliasRule[] = [];
	const configDirectories = new Set<string>();
	const workspacePackages: WorkspacePackage[] = [];
	const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
	const workspacePatterns = await loadWorkspacePatterns(entries);
	for (const entry of entries) {
		if (
			entry.path.endsWith("tsconfig.json") ||
			entry.path.endsWith("jsconfig.json") ||
			/(?:tsconfig|jsconfig)\.[^.]+\.json$/.test(entry.path)
		) {
			const configDirectory = path.posix.dirname(entry.path);
			configDirectories.add(configDirectory);
			aliases.push(
				...(await loadAliasRules(entry, entriesByPath, new Set())).map(
					(rule) => ({
						...rule,
						ownerDirectory: configDirectory,
					}),
				),
			);
		}
		if (path.posix.basename(entry.path) === "package.json") {
			const parsed = await readJson(entry);
			const manifest = record(parsed);
			const name = stringValue(manifest?.name);
			if (!name) continue;
			const root = path.posix.dirname(entry.path);
			if (
				root !== "." &&
				!workspacePatterns.some(({ root: workspaceRoot, pattern }) =>
					matchesWorkspacePattern(
						workspaceRoot === "."
							? root
							: path.posix.relative(workspaceRoot, root),
						pattern,
					),
				)
			) {
				continue;
			}
			const packageEntries = [
				stringValue(manifest?.module),
				stringValue(manifest?.main),
				stringValue(manifest?.types),
				...stringArray(manifest?.exports),
			]
				.filter((value): value is string => Boolean(value))
				.map((value) => path.posix.normalize(path.posix.join(root, value)));
			workspacePackages.push({
				name,
				root,
				entries:
					packageEntries.length > 0
						? packageEntries
						: [
								path.posix.join(root, "index.ts"),
								path.posix.join(root, "src/index.ts"),
							],
			});
		}
	}
	return {
		aliases,
		configDirectories: [...configDirectories].sort(
			(left, right) => right.length - left.length || left.localeCompare(right),
		),
		workspacePackages,
	};
}

async function loadWorkspacePatterns(
	entries: ProjectInventoryEntry[],
): Promise<Array<{ root: string; pattern: string }>> {
	const patterns: Array<{ root: string; pattern: string }> = [];
	for (const entry of entries) {
		const basename = path.posix.basename(entry.path);
		if (basename === "package.json") {
			const parsed = await readJson(entry);
			for (const pattern of stringArray(parsed?.workspaces)) {
				patterns.push({ root: path.posix.dirname(entry.path), pattern });
			}
		} else if (basename === "pnpm-workspace.yaml") {
			try {
				const content = await fs.readFile(entry.absolutePath, "utf8");
				for (const line of content.split(/\r?\n/)) {
					const pattern = line
						.match(/^\s*-\s*["']?([^"'#]+)["']?\s*$/)?.[1]
						?.trim();
					if (pattern)
						patterns.push({ root: path.posix.dirname(entry.path), pattern });
				}
			} catch {
				// Manifest analyzer reports unreadable content; resolver remains static.
			}
		}
	}
	return patterns;
}

function matchesWorkspacePattern(candidate: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/^\.\//, "")
		.split("**")
		.map((part) =>
			part
				.split("*")
				.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
				.join("[^/]*"),
		)
		.join(".*");
	return new RegExp(`^${escaped}$`).test(candidate);
}

async function loadAliasRules(
	entry: ProjectInventoryEntry,
	entriesByPath: Map<string, ProjectInventoryEntry>,
	seen: Set<string>,
): Promise<Omit<AliasRule, "ownerDirectory">[]> {
	if (seen.has(entry.path)) return [];
	seen.add(entry.path);
	const parsed = await readJson(entry);
	if (!parsed) return [];
	const configDirectory = path.posix.dirname(entry.path);
	let inherited: Omit<AliasRule, "ownerDirectory">[] = [];
	const extendsValue = stringValue(parsed.extends);
	if (extendsValue?.startsWith(".")) {
		const parentPath = path.posix.normalize(
			path.posix.join(
				configDirectory,
				extendsValue.endsWith(".json") ? extendsValue : `${extendsValue}.json`,
			),
		);
		const parent = entriesByPath.get(parentPath);
		if (parent) inherited = await loadAliasRules(parent, entriesByPath, seen);
	}
	const compilerOptions = record(parsed.compilerOptions);
	const paths = record(compilerOptions?.paths);
	if (!paths) return inherited;
	const localPatterns = new Set(Object.keys(paths));
	const local = Object.entries(paths).flatMap(([pattern, targets]) => {
		const values = stringArray(targets);
		return values.length > 0
			? [
					{
						pattern,
						targets: values,
						resolutionDirectory: configDirectory,
						baseUrl: stringValue(compilerOptions?.baseUrl) ?? ".",
					},
				]
			: [];
	});
	return [
		...inherited.filter((rule) => !localPatterns.has(rule.pattern)),
		...local,
	];
}

async function readJson(
	entry: ProjectInventoryEntry,
): Promise<Record<string, unknown> | null> {
	try {
		return record(JSON.parse(await fs.readFile(entry.absolutePath, "utf8")));
	} catch {
		return null;
	}
}

export function aliasCandidates(
	reference: UnresolvedStructureReference,
	config: ResolverConfig,
): string[] {
	const candidates: string[] = [];
	const importerDirectory = path.posix.dirname(reference.from);
	const nearestConfigDirectory = config.configDirectories.find(
		(directory) =>
			directory === "." ||
			importerDirectory === directory ||
			importerDirectory.startsWith(`${directory}/`),
	);
	if (!nearestConfigDirectory) return [];
	for (const rule of config.aliases.filter(
		(rule) => rule.ownerDirectory === nearestConfigDirectory,
	)) {
		const wildcard = rule.pattern.indexOf("*");
		const matches =
			wildcard < 0
				? reference.specifier === rule.pattern
				: reference.specifier.startsWith(rule.pattern.slice(0, wildcard)) &&
					reference.specifier.endsWith(rule.pattern.slice(wildcard + 1));
		if (!matches) continue;
		const value =
			wildcard < 0
				? ""
				: reference.specifier.slice(
						wildcard,
						reference.specifier.length -
							rule.pattern.slice(wildcard + 1).length,
					);
		for (const target of rule.targets) {
			const base = path.posix.normalize(
				path.posix.join(
					rule.resolutionDirectory,
					rule.baseUrl,
					target.replace("*", value),
				),
			);
			candidates.push(...relativeResolutionCandidates(base, "code_module"));
		}
	}
	return [...new Set(candidates)];
}

export function workspaceCandidates(
	specifier: string,
	config: ResolverConfig,
): string[] {
	const match = config.workspacePackages.find(
		(candidate) =>
			specifier === candidate.name ||
			specifier.startsWith(`${candidate.name}/`),
	);
	if (!match) return [];
	const suffix =
		specifier === match.name ? "" : specifier.slice(match.name.length + 1);
	if (!suffix)
		return match.entries.flatMap((entry) =>
			relativeResolutionCandidates(entry, "code_module"),
		);
	return relativeResolutionCandidates(
		path.posix.join(match.root, suffix),
		"code_module",
	);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function stringArray(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringArray);
	if (value && typeof value === "object")
		return Object.values(value).flatMap(stringArray);
	return [];
}
