import { load } from "cheerio";
import postcss from "postcss";
import type { ProjectStructureFile } from "../../../../../shared/schemas/project-structure.schema";
import type { ProjectInventoryEntry } from "../inventory";
import { TYPESCRIPT_JAVASCRIPT_ANALYZER } from "./typescript-javascript";

export type UnresolvedStructureReference = {
	from: string;
	specifier: string;
	kindHint: "code_module" | "stylesheet" | "asset" | "manifest";
};

export type AnalyzerOutput = {
	analyzerId: string;
	references: UnresolvedStructureReference[];
	diagnosticCodes: string[];
	roleHints?: string[];
	fileFacts?: Pick<
		ProjectStructureFile,
		"language" | "moduleKind" | "tags" | "exportedSymbols" | "identifiers"
	>;
};

export type ProjectStructureAnalyzer = {
	id: string;
	version: string;
	supports(entry: ProjectInventoryEntry): boolean;
	analyze(entry: ProjectInventoryEntry, bytes: Uint8Array): AnalyzerOutput;
};

const CSS_ANALYZER: ProjectStructureAnalyzer = {
	id: "css",
	version: "1",
	supports: (entry) => entry.kind === "style",
	analyze(entry, bytes) {
		const content = new TextDecoder().decode(bytes);
		const references: UnresolvedStructureReference[] = [];
		try {
			const root = postcss.parse(content, { from: entry.path });
			root.walkAtRules((rule) => {
				if (rule.name !== "import" && rule.name !== "reference") return;
				const specifier = firstCssSpecifier(rule.params);
				if (!specifier) return;
				references.push({
					from: entry.path,
					specifier,
					kindHint: "stylesheet",
				});
			});
			root.walkDecls((declaration) => {
				for (const specifier of cssUrlSpecifiers(declaration.value)) {
					references.push({
						from: entry.path,
						specifier,
						kindHint: "asset",
					});
				}
			});
			return { analyzerId: "css", references, diagnosticCodes: [] };
		} catch {
			return {
				analyzerId: "css",
				references: [],
				diagnosticCodes: ["analysis_css_parse_failed"],
			};
		}
	},
};

const HTML_ANALYZER: ProjectStructureAnalyzer = {
	id: "html",
	version: "1",
	supports: (entry) => entry.kind === "markup",
	analyze(entry, bytes) {
		const content = new TextDecoder().decode(bytes);
		const document = load(content);
		const references: UnresolvedStructureReference[] = [];
		document("script[src]").each((_, element) => {
			const specifier = document(element).attr("src");
			if (!specifier) return;
			references.push({ from: entry.path, specifier, kindHint: "code_module" });
		});
		document(
			'link[rel="stylesheet"][href], link[rel="modulepreload"][href]',
		).each((_, element) => {
			const specifier = document(element).attr("href");
			if (!specifier) return;
			references.push({
				from: entry.path,
				specifier,
				kindHint:
					document(element).attr("rel") === "stylesheet"
						? "stylesheet"
						: "code_module",
			});
		});
		return { analyzerId: "html", references, diagnosticCodes: [] };
	},
};

const MANIFEST_CONFIG_ANALYZER: ProjectStructureAnalyzer = {
	id: "manifest-config",
	version: "1",
	supports: (entry) => entry.kind === "manifest" || entry.kind === "config",
	analyze(entry, bytes) {
		const content = new TextDecoder().decode(bytes);
		if (!entry.path.endsWith(".json")) {
			return {
				analyzerId: "manifest-config",
				references: [],
				diagnosticCodes: [],
				roleHints: entry.path.endsWith("pnpm-workspace.yaml")
					? yamlWorkspacePatterns(content).map(
							(pattern) => `workspace-pattern:${pattern}`,
						)
					: [],
			};
		}
		try {
			const parsed = JSON.parse(content) as Record<string, unknown>;
			const references = relativeManifestReferences(entry.path, parsed);
			return {
				analyzerId: "manifest-config",
				references,
				diagnosticCodes: [],
				roleHints: entry.path.endsWith("package.json")
					? stringValues(parsed.workspaces).map(
							(pattern) => `workspace-pattern:${pattern}`,
						)
					: [],
			};
		} catch {
			return {
				analyzerId: "manifest-config",
				references: [],
				diagnosticCodes: ["analysis_manifest_parse_failed"],
			};
		}
	},
};

const ANALYZERS: ProjectStructureAnalyzer[] = [
	TYPESCRIPT_JAVASCRIPT_ANALYZER,
	CSS_ANALYZER,
	HTML_ANALYZER,
	MANIFEST_CONFIG_ANALYZER,
];

export function analyzerFor(
	entry: ProjectInventoryEntry,
): ProjectStructureAnalyzer | null {
	return ANALYZERS.find((analyzer) => analyzer.supports(entry)) ?? null;
}

function firstCssSpecifier(value: string): string | null {
	const quoted = value.match(/^\s*["']([^"']+)["']/);
	if (quoted?.[1]) return quoted[1];
	const url = value.match(/^\s*url\(\s*["']?([^"')]+)["']?\s*\)/i);
	return url?.[1] ?? null;
}

function cssUrlSpecifiers(value: string): string[] {
	return [...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)]
		.map((match) => match[1])
		.filter((value): value is string => Boolean(value));
}

function relativeManifestReferences(
	path: string,
	manifest: Record<string, unknown>,
): UnresolvedStructureReference[] {
	const references: UnresolvedStructureReference[] = [];
	for (const key of [
		"main",
		"module",
		"types",
		"browser",
		"exports",
		"imports",
		"extends",
	]) {
		for (const specifier of stringValues(manifest[key])) {
			if (!specifier.startsWith(".")) continue;
			references.push({ from: path, specifier, kindHint: "code_module" });
		}
	}
	return references;
}

function stringValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(stringValues);
	if (!value || typeof value !== "object") return [];
	return Object.values(value as Record<string, unknown>).flatMap(stringValues);
}

function yamlWorkspacePatterns(content: string): string[] {
	return content
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*-\s*["']?([^"'#]+)["']?\s*$/)?.[1]?.trim())
		.filter((value): value is string => Boolean(value));
}
