import { isBuiltin } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import type {
	ProjectStructureDiagnostic,
	ProjectStructureReference,
} from "../../../../../shared/schemas/project-structure.schema";
import { structureDiagnostic } from "../diagnostics";
import type { ProjectInventoryEntry } from "../inventory";
import type { UnresolvedStructureReference } from "../analyzers/registry";

const CODE_EXTENSIONS = [
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".cts",
	".mjs",
	".cjs",
];

export async function resolveStructureReferences(input: {
	references: UnresolvedStructureReference[];
	inventoryEntries: ProjectInventoryEntry[];
}): Promise<{
	references: ProjectStructureReference[];
	diagnostics: ProjectStructureDiagnostic[];
}> {
	const entriesByPath = new Map(
		input.inventoryEntries.map((entry) => [entry.path, entry]),
	);
	const entriesByLowerPath = new Map(
		input.inventoryEntries.map((entry) => [
			entry.path.toLocaleLowerCase("en-US"),
			entry,
		]),
	);
	const config = await loadResolverConfig(input.inventoryEntries);
	const diagnostics: ProjectStructureDiagnostic[] = [];
	const references = input.references.map((reference) => {
		const resolved = resolveReference(
			reference,
			entriesByPath,
			entriesByLowerPath,
			config,
		);
		if (resolved.status === "unresolved" || resolved.status === "ambiguous") {
			diagnostics.push(
				structureDiagnostic({
					code:
						resolved.diagnosticCodes[0] ??
						(resolved.status === "unresolved"
							? "resolution_target_missing"
							: "resolution_target_ambiguous"),
					scope: "resolution",
					impact: "degraded",
					path: reference.from,
					specifier: reference.specifier,
				}),
			);
		}
		if (resolved.status === "blocked") {
			diagnostics.push(
				structureDiagnostic({
					code: "resolution_target_outside_root",
					scope: "resolution",
					impact: "degraded",
					path: reference.from,
					specifier: reference.specifier,
				}),
			);
		}
		return resolved;
	});
	return {
		references: uniqueReferences(references),
		diagnostics: diagnostics.sort(compareDiagnostics),
	};
}

function resolveReference(
	reference: UnresolvedStructureReference,
	entriesByPath: Map<string, ProjectInventoryEntry>,
	entriesByLowerPath: Map<string, ProjectInventoryEntry>,
	config: ResolverConfig,
): ProjectStructureReference {
	const base = {
		from: reference.from,
		specifier: reference.specifier,
		kind: kindForReference(reference),
	};
	if (isRemoteOrInline(reference.specifier)) {
		return {
			...base,
			kind: "remote_url",
			status: "external",
			resolverId: "inline-url",
			confidence: 1,
			diagnosticCodes: [],
		};
	}
	if (
		reference.specifier.startsWith("node:") ||
		isBuiltin(reference.specifier)
	) {
		return {
			...base,
			kind: "runtime_builtin",
			status: "external",
			resolverId: "node-builtin",
			confidence: 1,
			diagnosticCodes: [],
		};
	}
	if (isVirtualModule(reference.specifier)) {
		return {
			...base,
			kind: "virtual_module",
			status: "external",
			resolverId: "virtual-module",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	if (!isRelativeSpecifier(reference.specifier)) {
		const aliasMatches = aliasCandidates(reference, config)
			.map((candidate) => entriesByPath.get(candidate))
			.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (aliasMatches.length === 1) {
			const [target] = aliasMatches;
			if (!target) throw new Error("Alias target unexpectedly missing.");
			return {
				...base,
				status:
					target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
				target: target.path,
				resolverId: "tsconfig-paths",
				confidence: 0.95,
				diagnosticCodes: [],
			};
		}
		if (aliasMatches.length > 1) {
			return {
				...base,
				status: "ambiguous",
				resolverId: "tsconfig-paths",
				confidence: 0.5,
				diagnosticCodes: ["resolution_target_ambiguous"],
			};
		}
		const workspaceMatches = workspaceCandidates(reference.specifier, config)
			.map((candidate) => entriesByPath.get(candidate))
			.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (workspaceMatches.length === 1) {
			const [target] = workspaceMatches;
			if (!target) throw new Error("Workspace target unexpectedly missing.");
			return {
				...base,
				kind: "workspace_package",
				status:
					target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
				target: target.path,
				resolverId: "workspace-package",
				confidence: 0.95,
				diagnosticCodes: [],
			};
		}
		return {
			...base,
			kind: "external_package",
			status: "external",
			resolverId: "external-package",
			confidence: 0.8,
			diagnosticCodes: [],
		};
	}

	const normalized = path.posix.normalize(
		path.posix.join(path.posix.dirname(reference.from), reference.specifier),
	);
	if (normalized === ".." || normalized.startsWith("../")) {
		return {
			...base,
			status: "blocked",
			resolverId: "relative-path",
			confidence: 1,
			diagnosticCodes: ["resolution_target_outside_root"],
		};
	}
	if (normalized === "node_modules" || normalized.startsWith("node_modules/")) {
		return {
			...base,
			status: "external",
			resolverId: "excluded-dependency",
			confidence: 0.9,
			diagnosticCodes: [],
		};
	}
	const candidates = relativeCandidates(normalized, reference.kindHint);
	const matches = candidates
		.map((candidate) => entriesByPath.get(candidate))
		.filter((entry): entry is ProjectInventoryEntry => Boolean(entry));
	if (matches.length === 0) {
		const caseMismatch = candidates
			.map((candidate) =>
				entriesByLowerPath.get(candidate.toLocaleLowerCase("en-US")),
			)
			.find((entry): entry is ProjectInventoryEntry => Boolean(entry));
		if (caseMismatch) {
			return {
				...base,
				status: "unresolved",
				resolverId: "relative-path",
				confidence: 1,
				diagnosticCodes: ["resolution_case_mismatch"],
			};
		}
		return {
			...base,
			status: "unresolved",
			resolverId: "relative-path",
			confidence: 1,
			diagnosticCodes: ["resolution_target_missing"],
		};
	}
	if (matches.length > 1) {
		return {
			...base,
			status: "ambiguous",
			resolverId: "relative-path",
			confidence: 0.5,
			diagnosticCodes: ["resolution_target_ambiguous"],
		};
	}
	const [target] = matches;
	if (!target) throw new Error("Resolved target unexpectedly missing.");
	return {
		...base,
		status: target.analyzerIds.length > 0 ? "resolved" : "resolved_unparsed",
		target: target.path,
		resolverId: "relative-path",
		confidence: 1,
		diagnosticCodes: [],
	};
}

type AliasRule = {
	pattern: string;
	targets: string[];
	ownerDirectory: string;
	resolutionDirectory: string;
	baseUrl: string;
};
type WorkspacePackage = { name: string; root: string; entries: string[] };
type ResolverConfig = {
	aliases: AliasRule[];
	configDirectories: string[];
	workspacePackages: WorkspacePackage[];
};

async function loadResolverConfig(
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
			const entries = [
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
					entries.length > 0
						? entries
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

function aliasCandidates(
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
			candidates.push(...relativeCandidates(base, "code_module"));
		}
	}
	return [...new Set(candidates)];
}

function workspaceCandidates(
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
			relativeCandidates(entry, "code_module"),
		);
	return relativeCandidates(path.posix.join(match.root, suffix), "code_module");
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

function kindForReference(
	reference: UnresolvedStructureReference,
): ProjectStructureReference["kind"] {
	if (reference.kindHint === "stylesheet") return "stylesheet";
	if (reference.kindHint === "asset") return "asset";
	if (reference.kindHint === "manifest") return "manifest";
	if (/\.(?:css)$/i.test(reference.specifier)) return "stylesheet";
	if (
		/\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|wasm)$/i.test(
			reference.specifier,
		)
	) {
		return "asset";
	}
	return "code_module";
}

function relativeCandidates(
	base: string,
	kindHint: UnresolvedStructureReference["kindHint"],
): string[] {
	if (kindHint !== "code_module") return [base];
	if (CODE_EXTENSIONS.includes(path.posix.extname(base))) return [base];
	return [
		base,
		...CODE_EXTENSIONS.map((extension) => `${base}${extension}`),
		...CODE_EXTENSIONS.map((extension) =>
			path.posix.join(base, `index${extension}`),
		),
	];
}

function isRelativeSpecifier(value: string): boolean {
	return value.startsWith("./") || value.startsWith("../");
}

function isRemoteOrInline(value: string): boolean {
	return (
		value.startsWith("#") ||
		value.startsWith("data:") ||
		value.startsWith("http:") ||
		value.startsWith("https:") ||
		value.startsWith("//")
	);
}

function isVirtualModule(value: string): boolean {
	return (
		value.startsWith("\0") ||
		value.startsWith("virtual:") ||
		value.startsWith("vite:")
	);
}

function uniqueReferences(
	references: ProjectStructureReference[],
): ProjectStructureReference[] {
	const byKey = new Map<string, ProjectStructureReference>();
	for (const reference of references) {
		const key = `${reference.from}\0${reference.specifier}\0${reference.kind}`;
		byKey.set(key, reference);
	}
	return [...byKey.values()].sort(
		(left, right) =>
			left.from.localeCompare(right.from) ||
			left.specifier.localeCompare(right.specifier) ||
			left.kind.localeCompare(right.kind),
	);
}

function compareDiagnostics(
	left: ProjectStructureDiagnostic,
	right: ProjectStructureDiagnostic,
): number {
	return (
		left.code.localeCompare(right.code) ||
		(left.path ?? "").localeCompare(right.path ?? "") ||
		(left.specifier ?? "").localeCompare(right.specifier ?? "")
	);
}
