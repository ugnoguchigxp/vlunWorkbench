import type {
	DetectorResult,
	PluginContext,
	ProjectDetector,
} from "../../modules/project-capabilities/plugin-contract";
import {
	matchesAnyPluginGlob,
	normalizePluginPath,
} from "../../modules/project-capabilities/path-patterns";

export function pathDetector(params: {
	id: string;
	pluginId: string;
	globs: readonly string[];
	kind: "extension" | "manifest" | "config";
	confidence?: DetectorResult["confidence"];
}): ProjectDetector {
	return {
		id: params.id,
		pluginId: params.pluginId,
		fileGlobs: params.globs,
		detect(context) {
			const evidence = context.inventory
				.filter((entry) => matchesAnyPluginGlob(entry.path, params.globs))
				.map((entry) => ({ path: entry.path, kind: params.kind }))
				.slice(0, 100);
			return {
				detected: evidence.length > 0,
				confidence: evidence.length > 0 ? (params.confidence ?? "high") : "low",
				evidence,
				limitations: [],
			};
		},
	};
}

export async function readJsonObject(
	context: PluginContext,
	relativePath: string,
): Promise<Record<string, unknown> | null> {
	const result = await context.readText(relativePath);
	if (!result.ok) return null;
	try {
		const parsed = JSON.parse(result.text);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export function dependencyNames(
	manifest: Record<string, unknown>,
): Set<string> {
	const output = new Set<string>();
	for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
		const value = manifest[key];
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		for (const name of Object.keys(value as Record<string, unknown>)) {
			output.add(name);
		}
	}
	return output;
}

export function hasInventoryPath(
	context: PluginContext,
	globs: readonly string[],
): boolean {
	return context.inventory.some((entry) =>
		matchesAnyPluginGlob(entry.path, globs),
	);
}

export function inventoryPaths(
	context: PluginContext,
	globs: readonly string[],
): string[] {
	return context.inventory
		.map((entry) => normalizePluginPath(entry.path))
		.filter((entry) => matchesAnyPluginGlob(entry, globs))
		.sort((left, right) => left.localeCompare(right));
}
