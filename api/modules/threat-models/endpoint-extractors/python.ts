import type { ExtractedEndpoint, SourceInput } from "./types";

const METHOD_DECORATOR =
	/@([A-Za-z_][\w]*)\.(get|head|options|post|put|patch|delete)\(\s*["']([^"']+)["']/gi;
const ROUTE_DECORATOR =
	/@([A-Za-z_][\w]*)\.route\(\s*["']([^"']+)["'][\s\S]{0,300}?methods\s*=\s*\[([^\]]+)\]/gi;
const DEFAULT_ROUTE_DECORATOR =
	/@([A-Za-z_][\w]*)\.route\(\s*["']([^"']+)["']\s*\)/gi;
const DJANGO_ROUTE =
	/@require_http_methods\(\s*\[([^\]]+)\]\s*\)[\s\S]{0,300}?def\s+([A-Za-z_][\w]*)\s*\([^)]*\)[\s\S]{0,1000}?\bpath\(\s*["']([^"']+)["']\s*,\s*\2\b/gi;

export function extractPythonEndpoints(
	source: SourceInput,
): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	for (const match of source.content.matchAll(METHOD_DECORATOR)) {
		output.push(
			endpoint(
				source,
				match,
				match[2].toUpperCase(),
				match[3],
				inferFramework(source.content),
			),
		);
	}
	for (const match of source.content.matchAll(ROUTE_DECORATOR)) {
		for (const method of match[3].match(
			/["'](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["']/gi,
		) ?? []) {
			output.push(
				endpoint(
					source,
					match,
					method.replace(/["']/g, "").toUpperCase(),
					match[2],
					"flask",
				),
			);
		}
	}
	for (const match of source.content.matchAll(DEFAULT_ROUTE_DECORATOR))
		output.push(endpoint(source, match, "GET", match[2], "flask"));
	for (const match of source.content.matchAll(DJANGO_ROUTE)) {
		for (const method of match[1].match(
			/["'](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["']/gi,
		) ?? [])
			output.push(
				endpoint(
					source,
					match,
					method.replace(/["']/g, "").toUpperCase(),
					match[3],
					"django",
				),
			);
	}
	return output;
}

function inferFramework(content: string): string {
	if (/from\s+fastapi|import\s+fastapi/.test(content)) return "fastapi";
	if (/from\s+flask|import\s+flask/.test(content)) return "flask";
	if (/from\s+django|import\s+django/.test(content)) return "django";
	return "python-http";
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

function normalizeTemplate(value: string): string {
	return (
		(value.startsWith("/") ? value : `/${value}`)
			.replace(/<(?:(?:path|str|int|uuid):)?([^>]+)>/g, "{$1}")
			.replace(/\/+/g, "/") || "/"
	);
}
