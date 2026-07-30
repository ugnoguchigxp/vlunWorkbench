import type { ExtractedEndpoint, SourceInput } from "./types";

const ROUTER_METHOD =
	/\b[A-Za-z_][\w]*\.(GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\(\s*["'`]([^"'`]+)["'`]/g;
const GO_122_PATTERN =
	/\b(?:http\.)?HandleFunc\(\s*["'`](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\s+([^"'`]+)["'`]/g;
const HANDLE_FUNC_PATTERN =
	/\b(?:http\.)?HandleFunc\(\s*["'`]([^"'`]+)["'`]\s*,[\s\S]{0,500}?\.(?:Method|Method\s*==)\s*(?:!=|==)?\s*["'`](GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)["'`]/g;

export function extractGoEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	for (const match of source.content.matchAll(ROUTER_METHOD))
		output.push(
			endpoint(
				source,
				match,
				match[1],
				match[2],
				inferFramework(source.content),
			),
		);
	for (const match of source.content.matchAll(GO_122_PATTERN))
		output.push(endpoint(source, match, match[1], match[2], "net/http"));
	for (const match of source.content.matchAll(HANDLE_FUNC_PATTERN))
		output.push(endpoint(source, match, match[2], match[1], "net/http"));
	return output;
}

function inferFramework(content: string): string {
	if (content.includes("github.com/gin-gonic/gin")) return "gin";
	if (content.includes("github.com/labstack/echo")) return "echo";
	return "go-router";
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
		path: (routePath.startsWith("/") ? routePath : `/${routePath}`)
			.replace(/:([A-Za-z_][\w]*)/g, "{$1}")
			.replace(/\/+/g, "/"),
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
