import type { ExtractedEndpoint, SourceInput } from "./types";

const ROUTE_PATTERN =
	/\b([A-Za-z_$][\w$]*)\.(get|head|options|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi;
const FASTIFY_ROUTE_PATTERN =
	/\b([A-Za-z_$][\w$]*)\.route\(\s*\{[\s\S]{0,500}?method\s*:\s*["'`](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["'`][\s\S]{0,500}?url\s*:\s*["'`]([^"'`]+)["'`]/gi;

export function extractJavaScriptTypeScriptEndpoints(
	source: SourceInput,
): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	for (const match of source.content.matchAll(ROUTE_PATTERN)) {
		const framework = inferFramework(source.content, match[1]);
		output.push(
			endpoint(source, match, match[2].toUpperCase(), match[3], framework),
		);
	}
	for (const match of source.content.matchAll(FASTIFY_ROUTE_PATTERN)) {
		output.push(endpoint(source, match, match[2], match[3], "fastify"));
	}
	return output;
}

function inferFramework(content: string, receiver: string): string {
	if (/from\s+["']hono["']|require\(["']hono["']\)/.test(content))
		return "hono";
	if (/from\s+["']fastify["']|require\(["']fastify["']\)/.test(content))
		return "fastify";
	if (/from\s+["']express["']|require\(["']express["']\)/.test(content))
		return "express";
	return /app|router/i.test(receiver) ? "express" : "javascript-http";
}

function endpoint(
	source: SourceInput,
	match: RegExpMatchArray,
	method: string,
	routePath: string,
	framework: string,
): ExtractedEndpoint {
	return {
		method: method as ExtractedEndpoint["method"],
		path: normalizeTemplate(routePath),
		framework,
		evidenceRefs: [
			{
				kind: "source",
				ref: `${source.path}:${lineAt(source.content, match.index ?? 0)}`,
				path: source.path,
				line: lineAt(source.content, match.index ?? 0),
			},
		],
	};
}

function normalizeTemplate(value: string): string {
	const withLeading = value.startsWith("/") ? value : `/${value}`;
	return (
		withLeading
			.replace(/:([A-Za-z_][\w]*)/g, "{$1}")
			.replace(/\*+/g, "{wildcard}")
			.replace(/\/+/g, "/") || "/"
	);
}

function lineAt(content: string, index: number): number {
	return content.slice(0, index).split("\n").length;
}
