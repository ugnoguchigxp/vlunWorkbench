import path from "node:path";
import type { ExtractedEndpoint, SourceInput } from "./types";
import { extractGoEndpoints } from "./go";
import { extractJavaEndpoints } from "./java";
import { extractJavaScriptTypeScriptEndpoints } from "./javascript-typescript";
import { extractPythonEndpoints } from "./python";
import { extractBuiltInPluginEndpoints } from "./plugin-registry";

export function extractEndpoints(
	source: SourceInput,
	options: { activePluginIds?: readonly string[] } = {},
): ExtractedEndpoint[] {
	const extension = path.extname(source.path).toLowerCase();
	const pluginEndpoints = extractBuiltInPluginEndpoints(
		source,
		options.activePluginIds,
	);
	if (
		options.activePluginIds &&
		[".js", ".jsx", ".ts", ".tsx", ".java"].includes(extension)
	) {
		return pluginEndpoints;
	}
	if ([".js", ".jsx", ".ts", ".tsx"].includes(extension)) {
		return mergeEndpoints([
			...pluginEndpoints,
			...extractJavaScriptTypeScriptEndpoints(source),
		]);
	}
	if (extension === ".java") {
		return mergeEndpoints([
			...pluginEndpoints,
			...extractJavaEndpoints(source),
		]);
	}
	switch (extension) {
		case ".py":
			return extractPythonEndpoints(source);
		case ".go":
			return extractGoEndpoints(source);
		default:
			return [];
	}
}

function mergeEndpoints(values: ExtractedEndpoint[]): ExtractedEndpoint[] {
	const byKey = new Map(
		values.map((endpoint) => [
			`${endpoint.method}\0${endpoint.path}\0${endpoint.framework}`,
			endpoint,
		]),
	);
	return [...byKey.values()];
}

export type { ExtractedEndpoint, SourceInput } from "./types";
