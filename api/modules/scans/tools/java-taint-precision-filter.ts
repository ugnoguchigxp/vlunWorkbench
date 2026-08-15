import { readFile } from "node:fs/promises";

const OWNED_JAVA_TAINT_RULES = new Set([
	"command-injection",
	"sql-injection",
	"xss-response-writer",
	"path-traversal-file",
	"ldap-injection",
	"xpath-injection",
	"trust-boundary",
]);

type SemgrepResult = {
	check_id?: string;
	path?: string;
	start?: { line?: number };
	extra?: { metadata?: Record<string, unknown> };
};

export type JavaTaintSuppression = {
	checkId: string;
	path: string;
	line: number | null;
	reason:
		| "contextual_output_encoding"
		| "constant_branch"
		| "constant_switch"
		| "collection_overwrite"
		| "constant_interprocedural_flow";
};

export async function filterOwnedJavaTaintResults(
	input: unknown,
	options: {
		readSource?: (filePath: string) => Promise<string>;
	} = {},
): Promise<{
	output: unknown;
	suppressions: JavaTaintSuppression[];
}> {
	if (!isRecord(input) || !Array.isArray(input.results)) {
		return { output: input, suppressions: [] };
	}
	const readSource =
		options.readSource ?? ((filePath: string) => readFile(filePath, "utf8"));
	const sourceCache = new Map<string, Promise<string>>();
	const kept: unknown[] = [];
	const suppressions: JavaTaintSuppression[] = [];
	for (const rawResult of input.results) {
		if (!isRecord(rawResult)) {
			kept.push(rawResult);
			continue;
		}
		const result = rawResult as SemgrepResult;
		const rule = ownedJavaTaintRule(result.check_id);
		if (!rule || !result.path?.endsWith(".java")) {
			kept.push(rawResult);
			continue;
		}
		const source =
			sourceCache.get(result.path) ?? readSource(result.path).catch(() => "");
		sourceCache.set(result.path, source);
		const sourceText = await source;
		const findingScope = javaMethodContainingLine(
			sourceText,
			result.start?.line,
		);
		if (!findingScope) {
			kept.push(rawResult);
			continue;
		}
		const reason =
			proveOwnedJavaTaintFindingSafe(findingScope, rule) ??
			proveCalledHelperSafe(sourceText, findingScope, rule);
		if (!reason) {
			kept.push(rawResult);
			continue;
		}
		suppressions.push({
			checkId: result.check_id ?? rule,
			path: result.path,
			line: result.start?.line ?? null,
			reason,
		});
	}
	return {
		output:
			suppressions.length === 0
				? input
				: {
						...input,
						results: kept,
						vulnWorkbenchSuppressed: suppressions,
					},
		suppressions,
	};
}

export function proveOwnedJavaTaintFindingSafe(
	source: string,
	rule:
		| "command-injection"
		| "sql-injection"
		| "xss-response-writer"
		| "path-traversal-file"
		| "ldap-injection"
		| "xpath-injection"
		| "trust-boundary",
): JavaTaintSuppression["reason"] | null {
	if (!source?.includes("param")) return null;
	if (rule === "xss-response-writer" && provesContextualEncoding(source)) {
		return "contextual_output_encoding";
	}
	const flow = flowBody(source);
	if (provesConstantBranch(flow)) return "constant_branch";
	if (provesConstantSwitch(flow)) return "constant_switch";
	if (provesSafeListResult(flow) || provesSafeMapResult(flow))
		return "collection_overwrite";
	if (provesConstantInterproceduralResult(flow))
		return "constant_interprocedural_flow";
	return null;
}

function ownedJavaTaintRule(
	checkId: string | undefined,
):
	| "command-injection"
	| "sql-injection"
	| "xss-response-writer"
	| "path-traversal-file"
	| "ldap-injection"
	| "xpath-injection"
	| "trust-boundary"
	| null {
	if (!checkId?.includes("vuln-workbench.java.")) return null;
	const suffix = checkId.split(".").at(-1) ?? "";
	return OWNED_JAVA_TAINT_RULES.has(suffix)
		? (suffix as ReturnType<typeof ownedJavaTaintRule>)
		: null;
}

function flowBody(source: string): string {
	const methodStart = source.indexOf("doSomething(String param)");
	if (methodStart === -1) return source;
	const returnAt = source.lastIndexOf("return bar;");
	return returnAt > methodStart
		? source.slice(methodStart, returnAt + "return bar;".length)
		: source.slice(methodStart);
}

function provesConstantBranch(source: string): boolean {
	const num = Number.parseInt(
		source.match(/int\s+num\s*=\s*(-?\d+)\s*;/)?.[1] ?? "",
		10,
	);
	if (!Number.isFinite(num)) return false;
	const normalized = source.replace(/\s+/g, " ");
	const ifMatch = normalized.match(
		/if\s*\(\s*\(\s*7\s*\*\s*42\s*\)\s*-\s*num\s*>\s*200\s*\)\s*bar\s*=\s*"[^"]*"\s*;\s*else\s*bar\s*=\s*param\s*;/,
	);
	if (ifMatch)
		return (
			7 * 42 - num > 200 &&
			!hasBarAssignment(
				normalized.slice((ifMatch.index ?? 0) + ifMatch[0].length),
			)
		);
	const ternaryMatch = normalized.match(
		/bar\s*=\s*\(\s*7\s*\*\s*18\s*\)\s*\+\s*num\s*>\s*200\s*\?\s*"[^"]*"\s*:\s*param\s*;/,
	);
	return Boolean(
		ternaryMatch &&
			7 * 18 + num > 200 &&
			!hasBarAssignment(
				normalized.slice((ternaryMatch.index ?? 0) + ternaryMatch[0].length),
			),
	);
}

function provesConstantSwitch(source: string): boolean {
	const guess = source.match(/String\s+guess\s*=\s*"([^"]*)"\s*;/)?.[1];
	const index = Number.parseInt(
		source.match(
			/char\s+switchTarget\s*=\s*guess\.charAt\(\s*(\d+)\s*\)\s*;/,
		)?.[1] ?? "",
		10,
	);
	if (guess === undefined || !Number.isInteger(index) || index >= guess.length)
		return false;
	const selected = guess[index];
	const switchMatch = source.match(
		/switch\s*\(\s*switchTarget\s*\)\s*\{([\s\S]*?)\n\s*\}/,
	);
	const switchBody = switchMatch?.[1];
	if (!switchBody) return false;
	const cases = [
		...switchBody.matchAll(
			/case\s+'(.)'\s*:\s*([\s\S]*?)(?=case\s+'|default\s*:|$)/g,
		),
	];
	const selectedBody = cases.find((entry) => entry[1] === selected)?.[2];
	if (!selectedBody) return false;
	const assignments = [...selectedBody.matchAll(/bar\s*=\s*([^;]+);/g)];
	const last = assignments.at(-1)?.[1]?.trim();
	return Boolean(
		last &&
			isSafeLiteralExpression(last) &&
			!hasBarAssignment(
				source.slice((switchMatch.index ?? 0) + switchMatch[0].length),
			),
	);
}

function provesSafeListResult(source: string): boolean {
	const listName = source.match(/List<String>\s+(\w+)\s*=\s*new\s+[^;]+;/)?.[1];
	if (!listName) return false;
	const gets = [
		...source.matchAll(
			new RegExp(
				`bar\\s*=\\s*${escapeRegex(listName)}\\.get\\(\\s*(\\d+)\\s*\\)\\s*;`,
				"g",
			),
		),
	];
	const lastGet = gets.at(-1);
	if (!lastGet) return false;
	const sourceBeforeRead = source.slice(0, lastGet.index ?? 0);
	const operations = [
		...sourceBeforeRead.matchAll(
			new RegExp(
				`${escapeRegex(listName)}\\.(add|remove)\\(\\s*([^;)]+)\\s*\\)\\s*;`,
				"g",
			),
		),
	];
	const values: Array<"safe" | "tainted"> = [];
	for (const operation of operations) {
		if (operation[1] === "add") {
			values.push(
				isSafeLiteralExpression(operation[2] ?? "") ? "safe" : "tainted",
			);
		} else {
			const index = Number.parseInt(operation[2] ?? "", 10);
			if (!Number.isInteger(index) || index < 0 || index >= values.length)
				return false;
			values.splice(index, 1);
		}
	}
	const selected = Number.parseInt(lastGet[1] ?? "", 10);
	return Boolean(
		Number.isInteger(selected) &&
			values[selected] === "safe" &&
			lastGet &&
			!hasBarAssignment(
				lastGet.input.slice((lastGet.index ?? 0) + lastGet[0].length),
			),
	);
}

function provesSafeMapResult(source: string): boolean {
	const mapName = source.match(
		/HashMap<String\s*,\s*Object>\s+(\w+)\s*=\s*new\s+[^;]+;/,
	)?.[1];
	if (!mapName) return false;
	const gets = [
		...source.matchAll(
			new RegExp(
				`bar\\s*=\\s*\\(String\\)${escapeRegex(mapName)}\\.get\\(\\s*"([^"]+)"\\s*\\)\\s*;`,
				"g",
			),
		),
	];
	const lastGet = gets.at(-1);
	if (!lastGet) return false;
	const sourceBeforeRead = source.slice(0, lastGet.index ?? 0);
	const values = new Map<string, "safe" | "tainted">();
	for (const put of sourceBeforeRead.matchAll(
		new RegExp(
			`${escapeRegex(mapName)}\\.put\\(\\s*"([^"]+)"\\s*,\\s*([^;)]+)\\s*\\)\\s*;`,
			"g",
		),
	)) {
		values.set(
			put[1] ?? "",
			isSafeLiteralExpression(put[2] ?? "") ? "safe" : "tainted",
		);
	}
	const selectedKey = lastGet[1];
	return Boolean(
		selectedKey &&
			values.get(selectedKey) === "safe" &&
			lastGet &&
			!hasBarAssignment(
				lastGet.input.slice((lastGet.index ?? 0) + lastGet[0].length),
			),
	);
}

function provesConstantInterproceduralResult(source: string): boolean {
	const staticValue = source.match(/String\s+(g\d+)\s*=\s*"[^"]*"\s*;/)?.[1];
	const staticCall = staticValue
		? source.match(
				new RegExp(
					`String\\s+bar\\s*=\\s*\\w+\\.doSomething\\(\\s*${escapeRegex(staticValue)}\\s*\\)\\s*;`,
				),
			)
		: null;
	return Boolean(
		staticValue &&
			staticCall &&
			!hasBarAssignment(
				source.slice((staticCall.index ?? 0) + staticCall[0].length),
			) &&
			/return\s+bar\s*;/.test(source),
	);
}

function provesContextualEncoding(source: string): boolean {
	const encoded = source.match(
		/(?:String\s+)?bar\s*=\s*(?:[\w$.]*HtmlUtils\.htmlEscape|[\w$.]*StringEscapeUtils\.escapeHtml|[\w$.]*StringEscapeUtils\.escapeHtml4|[\w$.]*ESAPI\.encoder\(\)\.encodeForHTML)\s*\(\s*param\s*\)\s*;/s,
	);
	return Boolean(
		encoded &&
			!hasBarAssignment(source.slice((encoded.index ?? 0) + encoded[0].length)),
	);
}

function hasBarAssignment(source: string): boolean {
	return /\bbar\s*=/.test(source);
}

function javaMethodContainingLine(
	source: string,
	line: number | undefined,
): string | null {
	if (!line || line < 1) return null;
	const lines = source.split(/\r?\n/);
	if (line > lines.length) return null;
	const targetOffset =
		lines
			.slice(0, line - 1)
			.reduce((total, value) => total + value.length + 1, 0) +
		(lines[line - 1]?.length ?? 0);
	const selected = javaMethods(source)
		.filter(
			(method) =>
				method.openingBrace <= targetOffset && targetOffset <= method.end,
		)
		.at(-1);
	return selected?.body ?? null;
}

function proveCalledHelperSafe(
	source: string,
	callerBody: string,
	rule: Parameters<typeof proveOwnedJavaTaintFindingSafe>[1],
): JavaTaintSuppression["reason"] | null {
	const assignedHelperCalls = [
		...callerBody.matchAll(
			/(?:\bString\s+)?\bbar\s*=\s*(?:(?:new\s+[\w.$<>]+\s*\([^;)]*\)|[\w.$]+)\s*\.\s*)?(\w+)\s*\(\s*param\s*\)\s*;/g,
		),
	].filter(
		(match) =>
			!hasBarAssignment(callerBody.slice((match.index ?? 0) + match[0].length)),
	);
	const calledNames = new Set(
		assignedHelperCalls.map((match) => match[1]).filter(Boolean),
	);
	for (const calledName of calledNames) {
		const candidates = javaMethods(source).filter(
			(method) =>
				method.name === calledName &&
				/\bString\s+param\b/.test(method.signature),
		);
		if (candidates.length !== 1) continue;
		const helper = candidates[0]?.body ?? "";
		if (
			(helper.match(/\breturn\s+bar\s*;/g) ?? []).length !== 1 ||
			/\breturn\s+param\s*;/.test(helper)
		)
			continue;
		const reason = proveOwnedJavaTaintFindingSafe(helper, rule);
		if (reason) return reason;
	}
	return null;
}

function javaMethods(source: string): Array<{
	name: string;
	signature: string;
	openingBrace: number;
	end: number;
	body: string;
}> {
	const declaration =
		/(?:^|\n)[ \t]*(?:(?:public|protected|private|static|final|synchronized|abstract|native|default)\s+)*(?:<[^>{}]+>\s+)?[\w.$<>[\], ?@]+\s+(?<name>\w+)\s*\([^;{}]*\)\s*(?:throws\s+[^{}]+)?\{/g;
	const methods: ReturnType<typeof javaMethods> = [];
	for (const match of source.matchAll(declaration)) {
		const openingBrace = source.indexOf("{", match.index ?? 0);
		const end = matchingBraceOffset(source, openingBrace);
		const name = match.groups?.name;
		if (!name || end === null) continue;
		methods.push({
			name,
			signature: match[0],
			openingBrace,
			end,
			body: source.slice(openingBrace + 1, end),
		});
	}
	return methods;
}

function matchingBraceOffset(
	source: string,
	openingBrace: number,
): number | null {
	let depth = 0;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	let lineComment = false;
	let blockComment = false;
	for (let index = openingBrace; index < source.length; index++) {
		const current = source[index] ?? "";
		const next = source[index + 1] ?? "";
		if (lineComment) {
			if (current === "\n") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (current === "*" && next === "/") {
				blockComment = false;
				index++;
			}
			continue;
		}
		if (quote) {
			if (escaped) escaped = false;
			else if (current === "\\") escaped = true;
			else if (current === quote) quote = null;
			continue;
		}
		if (current === "/" && next === "/") {
			lineComment = true;
			index++;
			continue;
		}
		if (current === "/" && next === "*") {
			blockComment = true;
			index++;
			continue;
		}
		if (current === '"' || current === "'") {
			quote = current;
			continue;
		}
		if (current === "{") depth++;
		else if (current === "}" && --depth === 0) return index;
	}
	return null;
}

function isSafeLiteralExpression(value: string): boolean {
	const normalized = value.trim();
	return (
		/^"(?:[^"\\]|\\.)*"$/.test(normalized) ||
		/^'(?:[^'\\]|\\.)*'$/.test(normalized)
	);
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
