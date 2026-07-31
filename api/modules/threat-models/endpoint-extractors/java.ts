import type { ExtractedEndpoint, SourceInput } from "./types";

const CLASS_PATTERN =
	/\b(?:class|interface|record)\s+[A-Za-z_$][\w$]*(?:\s+[^{]+)?\s*\{/g;
const SPRING_MAPPING =
	/@(Get|Post|Put|Patch|Delete|Request)Mapping\b(?:\s*\(([\s\S]{0,500}?)\))?/g;
const JAX_RS =
	/@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*(?:\r?\n|\s)+@Path\(\s*["']([^"']+)["']\s*\)/g;
const JAX_RS_PATH_FIRST =
	/@Path\(\s*["']([^"']+)["']\s*\)\s*(?:\r?\n|\s)+@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

export function extractJavaEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output = [
		...extractSpringEndpoints(source),
		...extractJaxRsEndpoints(source),
	];
	const byKey = new Map(
		output.map((item) => [
			`${item.framework}\0${item.method}\0${item.path}\0${item.evidenceRefs[0]?.ref ?? ""}`,
			item,
		]),
	);
	return [...byKey.values()];
}

function extractSpringEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	let classCount = 0;
	for (const classMatch of source.content.matchAll(CLASS_PATTERN)) {
		classCount++;
		const classStart = classMatch.index ?? 0;
		const bodyStart = classStart + classMatch[0].lastIndexOf("{") + 1;
		const bodyEnd = matchingBrace(source.content, bodyStart - 1);
		const body = source.content.slice(
			bodyStart,
			bodyEnd < 0 ? source.content.length : bodyEnd,
		);
		const classMapping = lastMappingBefore(source.content, classStart);
		const prefix = classMapping?.paths[0] ?? "/";
		for (const mapping of mappings(body, bodyStart)) {
			if (mapping.methods.length === 0) continue;
			for (const method of mapping.methods) {
				for (const route of mapping.paths) {
					output.push(
						endpoint(
							source,
							mapping.index,
							method,
							joinPaths(prefix, route),
							"spring-mvc",
						),
					);
				}
			}
		}
	}
	if (classCount === 0) {
		for (const mapping of mappings(source.content, 0)) {
			for (const method of mapping.methods) {
				for (const route of mapping.paths) {
					output.push(
						endpoint(source, mapping.index, method, route, "spring-mvc"),
					);
				}
			}
		}
	}
	return output;
}

function extractJaxRsEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	for (const match of source.content.matchAll(JAX_RS)) {
		output.push(
			endpoint(
				source,
				match.index ?? 0,
				match[1] ?? "GET",
				match[2] ?? "/",
				"jax-rs",
			),
		);
	}
	for (const match of source.content.matchAll(JAX_RS_PATH_FIRST)) {
		output.push(
			endpoint(
				source,
				match.index ?? 0,
				match[2] ?? "GET",
				match[1] ?? "/",
				"jax-rs",
			),
		);
	}
	return output;
}

function mappings(content: string, offset: number) {
	return [...content.matchAll(SPRING_MAPPING)].map((match) => {
		const mappingKind = match[1] ?? "Request";
		const args = match[2] ?? "";
		return {
			index: offset + (match.index ?? 0),
			paths: mappingPaths(args),
			methods:
				mappingKind === "Request"
					? requestMappingMethods(args)
					: [mappingKind.toUpperCase()],
		};
	});
}

function lastMappingBefore(content: string, classIndex: number) {
	const boundary = Math.max(
		content.lastIndexOf("}", classIndex - 1),
		content.lastIndexOf(";", classIndex - 1),
		0,
	);
	const candidates = mappings(content.slice(boundary, classIndex), boundary);
	return candidates.at(-1) ?? null;
}

function mappingPaths(args: string): string[] {
	const named =
		args.match(/(?:value|path)\s*=\s*(?:\{\s*)?["']([^"']+)["']/)?.[1] ?? null;
	const positional = args.match(/^\s*(?:\{\s*)?["']([^"']+)["']/)?.[1] ?? null;
	return [named ?? positional ?? "/"];
}

function requestMappingMethods(args: string): string[] {
	return [
		...new Set(
			[
				...args.matchAll(
					/RequestMethod\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)/g,
				),
			]
				.map((match) => match[1])
				.filter((value): value is string => Boolean(value)),
		),
	];
}

function matchingBrace(content: string, openingIndex: number): number {
	let depth = 0;
	let quote: string | null = null;
	let escaped = false;
	for (let index = openingIndex; index < content.length; index++) {
		const character = content[index];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === quote) {
				quote = null;
			}
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "{") depth++;
		if (character === "}") {
			depth--;
			if (depth === 0) return index;
		}
	}
	return -1;
}

function joinPaths(prefix: string, suffix: string): string {
	return normalizePath(`${prefix}/${suffix}`);
}

function normalizePath(value: string): string {
	const normalized = `/${value}`.replace(/\/+/g, "/");
	return normalized.length > 1 && normalized.endsWith("/")
		? normalized.slice(0, -1)
		: normalized;
}

function endpoint(
	source: SourceInput,
	index: number,
	method: string,
	routePath: string,
	framework: string,
): ExtractedEndpoint {
	const line = source.content.slice(0, index).split("\n").length;
	return {
		method: method as ExtractedEndpoint["method"],
		path: normalizePath(routePath),
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
