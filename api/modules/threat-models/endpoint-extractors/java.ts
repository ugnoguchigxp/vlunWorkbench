import type { ExtractedEndpoint, SourceInput } from "./types";

const SPRING_MAPPING =
	/@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
const JAX_RS =
	/@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*(?:\r?\n|\s)+@Path\(\s*["']([^"']+)["']\s*\)/g;
const JAX_RS_PATH_FIRST =
	/@Path\(\s*["']([^"']+)["']\s*\)\s*(?:\r?\n|\s)+@(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

export function extractJavaEndpoints(source: SourceInput): ExtractedEndpoint[] {
	const output: ExtractedEndpoint[] = [];
	for (const match of source.content.matchAll(SPRING_MAPPING))
		output.push(
			endpoint(source, match, match[1].toUpperCase(), match[2], "spring-mvc"),
		);
	for (const match of source.content.matchAll(JAX_RS))
		output.push(endpoint(source, match, match[1], match[2], "jax-rs"));
	for (const match of source.content.matchAll(JAX_RS_PATH_FIRST))
		output.push(endpoint(source, match, match[2], match[1], "jax-rs"));
	return output;
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
		path: (routePath.startsWith("/") ? routePath : `/${routePath}`).replace(
			/\/+/g,
			"/",
		),
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
