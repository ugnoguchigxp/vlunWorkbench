import path from "node:path";
import type {
	ProjectStructureAnalyzer,
	UnresolvedStructureReference,
} from "./types";

const PACKAGE_PATTERN = /^\s*package\s+([A-Za-z_]\w*)/m;
const SINGLE_IMPORT_PATTERN =
	/^\s*import\s+(?:[._A-Za-z]\w*\s+)?["`]([^"`]+)["`]/gm;
const GROUPED_IMPORT_PATTERN = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
const GROUPED_IMPORT_ENTRY = /^\s*(?:[._A-Za-z]\w*\s+)?["`]([^"`]+)["`]/gm;
const TYPE_PATTERN = /^\s*type\s+([A-Za-z_]\w*)\s+/gm;
const FUNCTION_PATTERN = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm;

export const GO_SOURCE_ANALYZER: ProjectStructureAnalyzer = {
	id: "go-source",
	version: "1",
	supports: (entry) =>
		entry.kind === "source" &&
		path.posix.extname(entry.path).toLowerCase() === ".go",
	analyze(entry, bytes) {
		let content: string;
		try {
			content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return {
				analyzerId: "go-source",
				references: [],
				diagnosticCodes: ["analysis_go_encoding_failed"],
			};
		}
		const code = maskGoComments(content);
		const packageName = code.match(PACKAGE_PATTERN)?.[1] ?? null;
		const imports: string[] = [];
		for (const match of code.matchAll(SINGLE_IMPORT_PATTERN)) {
			if (match[1]) imports.push(match[1]);
		}
		for (const block of code.matchAll(GROUPED_IMPORT_PATTERN)) {
			for (const match of (block[1] ?? "").matchAll(GROUPED_IMPORT_ENTRY)) {
				if (match[1]) imports.push(match[1]);
			}
		}
		const types = [...code.matchAll(TYPE_PATTERN)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const functions = [...code.matchAll(FUNCTION_PATTERN)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const isTest = entry.path.endsWith("_test.go");
		const generated = /^\/\/ Code generated .* DO NOT EDIT\.$/m.test(content);
		const hasBuildTag = /^\/\/(?:go:build|\s*\+build)\s+/m.test(content);
		const entrypoint =
			packageName === "main" && functions.includes("main") && !isTest;
		const diagnosticCodes: string[] = [];
		if (!bracesBalanced(maskGoStrings(code))) {
			diagnosticCodes.push("analysis_go_syntax_partial");
		}
		if (hasBuildTag)
			diagnosticCodes.push("analysis_go_build_constraints_partial");
		if (generated) diagnosticCodes.push("analysis_go_generated_source");
		const references: UnresolvedStructureReference[] = uniqueSorted(
			imports,
		).map((specifier) => ({
			from: entry.path,
			specifier,
			kindHint: "go_import",
		}));
		return {
			analyzerId: "go-source",
			references,
			diagnosticCodes,
			roleHints: [
				...(entrypoint ? ["entrypoint"] : []),
				...(generated ? ["generated"] : []),
				...(hasBuildTag ? ["build-constraint"] : []),
			],
			fileFacts: {
				language: "go",
				moduleKind: "unknown",
				tags: goTags(entry.path, code, entrypoint),
				exportedSymbols: uniqueSorted(
					[...types, ...functions].filter((name) => /^[A-Z]/.test(name)),
				),
				identifiers: uniqueSorted([
					...(packageName ? [packageName] : []),
					...types,
					...functions,
				]).slice(0, 256),
			},
		};
	},
};

function maskGoComments(content: string): string {
	return content
		.replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, " "))
		.replace(/\/\/[^\n]*/g, (value) => " ".repeat(value.length));
}

function maskGoStrings(content: string): string {
	return content
		.replace(/`[\s\S]*?`/g, (value) => value.replace(/[^\n]/g, " "))
		.replace(/"(?:\\.|[^"\\])*"/g, (value) => " ".repeat(value.length))
		.replace(/'(?:\\.|[^'\\])*'/g, (value) => " ".repeat(value.length));
}

function bracesBalanced(content: string): boolean {
	let depth = 0;
	for (const character of content) {
		if (character === "{") depth += 1;
		if (character === "}") depth -= 1;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function goTags(filePath: string, content: string, entrypoint: boolean) {
	const tags = new Set<
		"route" | "handler" | "schema" | "worker" | "test" | "config" | "source"
	>();
	if (filePath.endsWith("_test.go")) tags.add("test");
	if (
		/\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/.test(content) ||
		/\bHandleFunc\s*\(/.test(content)
	) {
		tags.add("route");
		tags.add("handler");
	}
	if (entrypoint) tags.add("handler");
	if (!tags.has("test")) tags.add("source");
	return [...tags];
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
