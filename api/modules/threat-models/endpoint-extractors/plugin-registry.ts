import path from "node:path";
import { builtInTechnologyPluginRegistry } from "../../../plugins/builtin";
import type { ExtractedEndpoint, SourceInput } from "./types";

export function extractBuiltInPluginEndpoints(
	source: SourceInput,
	activePluginIds?: readonly string[],
): ExtractedEndpoint[] {
	const extension = path.extname(source.path).toLowerCase();
	const activeIds = activePluginIds ? new Set(activePluginIds) : null;
	const contributions = builtInTechnologyPluginRegistry
		.endpointExtractors()
		.filter(
			(contribution) =>
				contribution.extensions.includes(extension) &&
				(activeIds === null || activeIds.has(contribution.pluginId)),
		);
	const byKey = new Map<string, ExtractedEndpoint>();
	for (const contribution of contributions) {
		for (const endpoint of contribution.extract(source)) {
			byKey.set(
				`${endpoint.method}\0${endpoint.path}\0${endpoint.framework}`,
				endpoint,
			);
		}
	}
	return [...byKey.values()];
}
