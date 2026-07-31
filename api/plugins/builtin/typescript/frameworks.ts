import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { extractJavaScriptTypeScriptEndpoints } from "../../../modules/threat-models/endpoint-extractors/javascript-typescript";
import { dependencyNames, inventoryPaths, readJsonObject } from "../helpers";

export const typescriptFrameworkPlugins: TechnologyPluginV1[] = [
	frameworkPlugin("hono"),
	frameworkPlugin("express"),
	frameworkPlugin("fastify"),
];

function frameworkPlugin(
	framework: "hono" | "express" | "fastify",
): TechnologyPluginV1 {
	const pluginId = `framework.typescript.${framework}`;
	return {
		manifest: {
			schemaVersion: 1,
			pluginApiVersion: "1",
			id: pluginId,
			version: "1.0.0",
			kind: "framework",
			displayName:
				framework === "hono"
					? "Hono"
					: framework === "express"
						? "Express"
						: "Fastify",
			requires: {
				allOf: ["language.typescript", "build.npm"],
				oneOf: [],
			},
			declaredCapabilities: ["endpoint_extraction", "dast_start"],
		},
		detectors: [
			{
				id: `detect.${pluginId}`,
				pluginId,
				fileGlobs: ["package.json", "**/package.json"],
				async detect(context) {
					const evidence: Array<{
						path: string;
						kind: "dependency";
					}> = [];
					for (const manifestPath of inventoryPaths(context, [
						"package.json",
						"**/package.json",
					])) {
						const manifest = await readJsonObject(context, manifestPath);
						if (manifest && dependencyNames(manifest).has(framework)) {
							evidence.push({ path: manifestPath, kind: "dependency" });
						}
					}
					return {
						detected: evidence.length > 0,
						confidence: evidence.length > 0 ? "high" : "low",
						evidence,
						limitations: [],
					};
				},
			},
		],
		dependencyProviders: [],
		sourceAnalyzers: [],
		endpointExtractors: [
			{
				id: `endpoint.${pluginId}`,
				pluginId,
				extensions: [".ts", ".tsx", ".js", ".jsx"],
				frameworks: [framework],
				extract(source) {
					return extractJavaScriptTypeScriptEndpoints(source).filter(
						(endpoint) => endpoint.framework === framework,
					);
				},
			},
		],
		semgrepRules: [],
		startPlanners: [],
	};
}
