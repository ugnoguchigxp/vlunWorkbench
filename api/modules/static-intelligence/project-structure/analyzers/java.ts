import path from "node:path";
import type {
	ProjectStructureAnalyzer,
	UnresolvedStructureReference,
} from "./types";

const PACKAGE_PATTERN =
	/\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/;
const IMPORT_PATTERN =
	/\bimport\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$*][\w$*]*)+)\s*;/g;
const TYPE_PATTERN =
	/(?:^|\s)(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|sealed\s+|non-sealed\s+|static\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/gm;
const ANNOTATION_PATTERN = /@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;

export const JAVA_SOURCE_ANALYZER: ProjectStructureAnalyzer = {
	id: "java-source",
	version: "1",
	supports: (entry) =>
		entry.kind === "source" &&
		path.posix.extname(entry.path).toLowerCase() === ".java",
	analyze(entry, bytes) {
		const content = new TextDecoder().decode(bytes);
		const packageName = content.match(PACKAGE_PATTERN)?.[1] ?? null;
		const imports = [...content.matchAll(IMPORT_PATTERN)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const exportedSymbols = [...content.matchAll(TYPE_PATTERN)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const annotations = [...content.matchAll(ANNOTATION_PATTERN)]
			.map((match) => match[1]?.split(".").at(-1))
			.filter((value): value is string => Boolean(value));
		const references: UnresolvedStructureReference[] = [
			...new Set(imports),
		].map((specifier) => ({
			from: entry.path,
			specifier,
			kindHint: "java_import",
		}));
		const identifiers = [
			...(packageName ? packageName.split(".") : []),
			...exportedSymbols,
			...annotations,
		];
		return {
			analyzerId: "java-source",
			references,
			diagnosticCodes: bracesBalanced(content)
				? []
				: ["analysis_java_syntax_partial"],
			fileFacts: {
				language: "java",
				moduleKind: "unknown",
				tags: tagsForJavaFile(entry.path, annotations),
				exportedSymbols: uniqueSorted(exportedSymbols),
				identifiers: uniqueSorted(identifiers).slice(0, 256),
			},
		};
	},
};

function bracesBalanced(content: string): boolean {
	let depth = 0;
	for (const character of content.replace(
		/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
		"",
	)) {
		if (character === "{") depth++;
		if (character === "}") depth--;
		if (depth < 0) return false;
	}
	return depth === 0;
}

function tagsForJavaFile(pathValue: string, annotations: string[]) {
	const tags = new Set<
		"route" | "handler" | "schema" | "worker" | "test" | "config" | "source"
	>();
	const lower = pathValue.toLowerCase();
	if (
		lower.includes("/test/") ||
		lower.endsWith("test.java") ||
		lower.endsWith("tests.java")
	) {
		tags.add("test");
	}
	if (
		annotations.some((annotation) =>
			[
				"RequestMapping",
				"GetMapping",
				"PostMapping",
				"PutMapping",
				"PatchMapping",
				"DeleteMapping",
			].includes(annotation),
		)
	) {
		tags.add("route");
	}
	if (
		annotations.some((annotation) =>
			["Controller", "RestController"].includes(annotation),
		)
	) {
		tags.add("handler");
	}
	if (!tags.has("test")) tags.add("source");
	return [
		"route",
		"handler",
		"schema",
		"worker",
		"test",
		"config",
		"source",
	].filter(
		(
			tag,
		): tag is
			| "route"
			| "handler"
			| "schema"
			| "worker"
			| "test"
			| "config"
			| "source" => tags.has(tag as never),
	);
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
