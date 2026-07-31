import type { ExtractedEndpoint, SourceInput } from "./types";

const METHOD_DECORATOR =
	/@([A-Za-z_]\w*)\.(get|head|options|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
const ROUTE_DECORATOR =
	/@([A-Za-z_]\w*)\.route\(\s*["']([^"']+)["'][\s\S]{0,300}?methods\s*=\s*\[([^\]]+)\]/gi;
const DEFAULT_ROUTE_DECORATOR =
	/@([A-Za-z_]\w*)\.route\(\s*["']([^"']+)["']\s*\)/gi;
const DJANGO_ROUTE =
	/@require_http_methods\(\s*\[([^\]]+)\]\s*\)[\s\S]{0,300}?def\s+([A-Za-z_]\w*)\s*\([^)]*\)[\s\S]{0,1000}?\bpath\(\s*["']([^"']+)["']\s*,\s*\2\b/gi;

type PythonWebFramework = "fastapi" | "flask";

type PythonFrameworkEvidence = {
	imports: Set<PythonWebFramework>;
	frameworkByReceiver: Map<string, PythonWebFramework>;
	prefixes: Map<string, string>;
};

export function extractPythonEndpoints(
	source: SourceInput,
): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	const evidence = pythonFrameworkEvidence(source.content);
	for (const match of source.content.matchAll(METHOD_DECORATOR)) {
		if (!isPythonCodePosition(source.content, match.index ?? 0)) continue;
		const receiver = match[1] ?? "";
		output.push(
			endpoint(
				source,
				match,
				(match[2] ?? "").toUpperCase(),
				joinRoute(evidence.prefixes.get(receiver) ?? "", match[3] ?? ""),
				frameworkForReceiver(evidence, receiver),
			),
		);
	}
	for (const match of source.content.matchAll(ROUTE_DECORATOR)) {
		if (!isPythonCodePosition(source.content, match.index ?? 0)) continue;
		const receiver = match[1] ?? "";
		for (const method of (match[3] ?? "").match(
			/["'](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["']/gi,
		) ?? []) {
			output.push(
				endpoint(
					source,
					match,
					method.replace(/["']/g, "").toUpperCase(),
					joinRoute(evidence.prefixes.get(receiver) ?? "", match[2] ?? ""),
					frameworkForReceiver(evidence, receiver),
				),
			);
		}
	}
	for (const match of source.content.matchAll(DEFAULT_ROUTE_DECORATOR)) {
		if (!isPythonCodePosition(source.content, match.index ?? 0)) continue;
		const receiver = match[1] ?? "";
		output.push(
			endpoint(
				source,
				match,
				"GET",
				joinRoute(evidence.prefixes.get(receiver) ?? "", match[2] ?? ""),
				frameworkForReceiver(evidence, receiver),
			),
		);
	}
	for (const match of source.content.matchAll(DJANGO_ROUTE)) {
		if (!isPythonCodePosition(source.content, match.index ?? 0)) continue;
		for (const method of (match[1] ?? "").match(
			/["'](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["']/gi,
		) ?? []) {
			output.push(
				endpoint(
					source,
					match,
					method.replace(/["']/g, "").toUpperCase(),
					match[3] ?? "",
					"django",
				),
			);
		}
	}
	return dedupe(output);
}

function pythonFrameworkEvidence(content: string): PythonFrameworkEvidence {
	const imports = new Set<PythonWebFramework>();
	const constructors = new Map<string, PythonWebFramework>();
	for (const match of content.matchAll(
		/^\s*from\s+(fastapi|flask)(?:\.[A-Za-z_]\w*)*\s+import\s+([^#\n]+)/gm,
	)) {
		if (!isPythonCodePosition(content, match.index ?? 0)) continue;
		const framework = match[1] as PythonWebFramework;
		imports.add(framework);
		for (const item of (match[2] ?? "").split(",")) {
			const imported = item
				.trim()
				.match(/^([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?$/);
			const original = imported?.[1];
			const local = imported?.[2] ?? original;
			if (
				local &&
				((framework === "fastapi" &&
					["FastAPI", "APIRouter"].includes(original ?? "")) ||
					(framework === "flask" &&
						["Flask", "Blueprint"].includes(original ?? "")))
			) {
				constructors.set(local, framework);
			}
		}
	}
	for (const match of content.matchAll(
		/^\s*import\s+(fastapi|flask)(?:\s+as\s+([A-Za-z_]\w*))?/gm,
	)) {
		if (!isPythonCodePosition(content, match.index ?? 0)) continue;
		const framework = match[1] as PythonWebFramework;
		const alias = match[2] ?? framework;
		imports.add(framework);
		for (const constructorName of framework === "fastapi"
			? ["FastAPI", "APIRouter"]
			: ["Flask", "Blueprint"]) {
			constructors.set(`${alias}.${constructorName}`, framework);
		}
	}
	const frameworkByReceiver = new Map<string, PythonWebFramework>();
	const prefixes = new Map<string, string>();
	if (constructors.size > 0) {
		const constructorPattern = [...constructors.keys()]
			.sort((left, right) => right.length - left.length)
			.map(escapeRegExp)
			.join("|");
		const assignment = new RegExp(
			`\\b([A-Za-z_]\\w*)\\s*=\\s*(${constructorPattern})\\s*\\(([^\\n#)]*)`,
			"g",
		);
		for (const match of content.matchAll(assignment)) {
			if (!isPythonCodePosition(content, match.index ?? 0)) continue;
			const receiver = match[1];
			const framework = constructors.get(match[2] ?? "");
			if (!receiver || !framework) continue;
			frameworkByReceiver.set(receiver, framework);
			const prefix = (match[3] ?? "").match(
				/(?:^|,)\s*(?:prefix|url_prefix)\s*=\s*["']([^"']+)["']/,
			)?.[1];
			if (prefix) prefixes.set(receiver, prefix);
		}
	}
	return { imports, frameworkByReceiver, prefixes };
}

function frameworkForReceiver(
	evidence: PythonFrameworkEvidence,
	receiver: string,
): PythonWebFramework | "python-http" {
	const explicit = evidence.frameworkByReceiver.get(receiver);
	if (explicit) return explicit;
	return evidence.imports.size === 1
		? ([...evidence.imports][0] ?? "python-http")
		: "python-http";
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
		if (character === "#") comment = true;
		if (character === "'" || character === '"') {
			quote = character;
			triple = content.slice(index, index + 3) === character.repeat(3);
			if (triple) index += 2;
		}
	}
	return !quote && !comment;
}

function endpoint(
	source: SourceInput,
	match: RegExpMatchArray,
	method: string,
	routePath: string,
	framework: string,
): ExtractedEndpoint {
	const line = source.content.slice(0, match.index ?? 0).split("\n").length;
	return {
		method: method as ExtractedEndpoint["method"],
		path: normalizeTemplate(routePath),
		framework,
		evidenceRefs: [
			{
				kind: "source",
				ref: `${source.path}:${line}`,
				path: source.path,
				line,
			},
		],
	};
}

function joinRoute(prefix: string, routePath: string): string {
	return `${prefix.replace(/\/$/, "")}/${routePath.replace(/^\//, "")}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTemplate(value: string): string {
	return (
		(value.startsWith("/") ? value : `/${value}`)
			.replace(/<(?:(?:path|str|int|uuid):)?([^>]+)>/g, "{$1}")
			.replace(/\/+/g, "/") || "/"
	);
}

function dedupe(values: ExtractedEndpoint[]): ExtractedEndpoint[] {
	return [
		...new Map(
			values.map((value) => [
				`${value.method}\0${value.path}\0${value.framework}`,
				value,
			]),
		).values(),
	];
}
