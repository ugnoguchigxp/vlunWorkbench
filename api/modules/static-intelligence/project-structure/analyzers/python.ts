import path from "node:path";
import type {
	ProjectStructureAnalyzer,
	UnresolvedStructureReference,
} from "./types";

const IMPORT_PATTERN = /^\s*import\s+([^#\n]+)$/gm;
const FROM_IMPORT_PATTERN =
	/^\s*from\s+([.A-Za-z_][\w.]*)\s+import\s+([^#\n]+)/gm;
const TOP_LEVEL_DEFINITION = /^(?:async\s+def|def|class)\s+([A-Za-z_]\w*)\b/gm;
const DECORATOR_PATTERN = /^\s*@([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gm;

export const PYTHON_SOURCE_ANALYZER: ProjectStructureAnalyzer = {
	id: "python-source",
	version: "1",
	supports: (entry) =>
		entry.kind === "source" &&
		[".py", ".pyi"].includes(path.posix.extname(entry.path).toLowerCase()),
	analyze(entry, bytes) {
		let content: string;
		try {
			content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return {
				analyzerId: "python-source",
				references: [],
				diagnosticCodes: ["analysis_python_encoding_failed"],
			};
		}
		const code = maskPythonCommentsAndStrings(content);
		const imports: string[] = [];
		for (const match of code.matchAll(IMPORT_PATTERN)) {
			for (const clause of (match[1] ?? "").split(",")) {
				const specifier = clause
					.trim()
					.split(/\s+as\s+/i)[0]
					?.trim();
				if (specifier) imports.push(specifier);
			}
		}
		for (const match of code.matchAll(FROM_IMPORT_PATTERN)) {
			if (!match[1]) continue;
			imports.push(match[1]);
			if (/^\.+$/.test(match[1])) {
				for (const imported of (match[2] ?? "").split(",")) {
					const name = imported
						.trim()
						.split(/\s+as\s+/i)[0]
						?.trim();
					if (name && /^[A-Za-z_]\w*$/.test(name))
						imports.push(`${match[1]}${name}`);
				}
			}
		}
		const definitions = [...code.matchAll(TOP_LEVEL_DEFINITION)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const decorators = [...code.matchAll(DECORATOR_PATTERN)]
			.map((match) => match[1])
			.filter((value): value is string => Boolean(value));
		const entrypoint = hasPythonMainGuard(content);
		const diagnosticCodes: string[] = [];
		if (!delimitersBalanced(code)) {
			diagnosticCodes.push("analysis_python_syntax_partial");
		}
		if (entry.path.endsWith(".pyi")) {
			diagnosticCodes.push("analysis_python_stub_not_runtime_entrypoint");
		}
		const references: UnresolvedStructureReference[] = uniqueSorted(
			imports,
		).map((specifier) => ({
			from: entry.path,
			specifier,
			kindHint: "python_import",
		}));
		return {
			analyzerId: "python-source",
			references,
			diagnosticCodes,
			roleHints:
				entrypoint && !entry.path.endsWith(".pyi") ? ["entrypoint"] : [],
			fileFacts: {
				language: "python",
				moduleKind: "unknown",
				tags: pythonTags(entry.path, decorators, entrypoint),
				exportedSymbols: uniqueSorted(definitions),
				identifiers: uniqueSorted([...definitions, ...decorators]).slice(
					0,
					256,
				),
			},
		};
	},
};

function maskPythonCommentsAndStrings(content: string): string {
	let output = "";
	let index = 0;
	let quote: "'" | '"' | null = null;
	let triple = false;
	let escaped = false;
	let comment = false;
	while (index < content.length) {
		const character = content[index] ?? "";
		if (comment) {
			if (character === "\n") {
				comment = false;
				output += "\n";
			} else output += " ";
			index += 1;
			continue;
		}
		if (quote) {
			if (character === "\n") output += "\n";
			else output += " ";
			if (!escaped) {
				if (triple && content.slice(index, index + 3) === quote.repeat(3)) {
					output += "  ";
					index += 3;
					quote = null;
					triple = false;
					continue;
				}
				if (!triple && character === quote) quote = null;
			}
			escaped = !escaped && character === "\\";
			if (character !== "\\") escaped = false;
			index += 1;
			continue;
		}
		if (character === "#") {
			comment = true;
			output += " ";
			index += 1;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			triple = content.slice(index, index + 3) === character.repeat(3);
			output += triple ? "   " : " ";
			index += triple ? 3 : 1;
			continue;
		}
		output += character;
		index += 1;
	}
	return output;
}

function hasPythonMainGuard(content: string): boolean {
	const pattern = /^\s*if\s+__name__\s*==\s*["']__main__["']\s*:/gm;
	for (const match of content.matchAll(pattern)) {
		if (isPythonCodePosition(content, match.index ?? 0)) return true;
	}
	return false;
}

function isPythonCodePosition(content: string, target: number): boolean {
	let quote: "'" | '"' | null = null;
	let triple = false;
	let escaped = false;
	let comment = false;
	for (let index = 0; index < target; index += 1) {
		const character = content[index] ?? "";
		if (comment) {
			if (character === "\n") comment = false;
			continue;
		}
		if (quote) {
			if (
				!escaped &&
				triple &&
				content.slice(index, index + 3) === quote.repeat(3)
			) {
				index += 2;
				quote = null;
				triple = false;
				continue;
			}
			if (!escaped && !triple && character === quote) quote = null;
			escaped = !escaped && character === "\\";
			if (character !== "\\") escaped = false;
			continue;
		}
		if (character === "#") {
			comment = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			triple = content.slice(index, index + 3) === character.repeat(3);
			if (triple) index += 2;
		}
	}
	return !quote && !comment;
}

function delimitersBalanced(content: string): boolean {
	const stack: string[] = [];
	const closeToOpen: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	for (const character of content) {
		if (["(", "[", "{"].includes(character)) stack.push(character);
		if (character in closeToOpen && stack.pop() !== closeToOpen[character]) {
			return false;
		}
	}
	return stack.length === 0;
}

function pythonTags(
	filePath: string,
	decorators: string[],
	entrypoint: boolean,
) {
	const tags = new Set<
		"route" | "handler" | "schema" | "worker" | "test" | "config" | "source"
	>();
	const lower = filePath.toLowerCase();
	if (lower.includes("/test") || /(^|\/)test_.*\.py$/.test(lower))
		tags.add("test");
	if (
		decorators.some((decorator) =>
			/(?:^|\.)(?:get|post|put|patch|delete|head|options|route)$/.test(
				decorator,
			),
		)
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
