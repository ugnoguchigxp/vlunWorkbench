import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { TYPESCRIPT_JAVASCRIPT_ANALYZER } from "../../../modules/static-intelligence/project-structure/analyzers/typescript-javascript";
import { extractJavaScriptTypeScriptEndpoints } from "../../../modules/threat-models/endpoint-extractors/javascript-typescript";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "language.typescript";

export const typescriptLanguagePlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "language",
		displayName: "TypeScript",
		requires: { allOf: [], oneOf: [] },
		declaredCapabilities: [
			"source_detection",
			"sast",
			"project_structure",
			"endpoint_extraction",
		],
	},
	detectors: [
		pathDetector({
			id: "detect.language.typescript",
			pluginId: PLUGIN_ID,
			globs: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
			kind: "extension",
		}),
	],
	dependencyProviders: [],
	sourceAnalyzers: [
		{
			id: "typescript-javascript",
			pluginId: PLUGIN_ID,
			version: "2",
			extensions: [
				".ts",
				".tsx",
				".mts",
				".cts",
				".js",
				".jsx",
				".mjs",
				".cjs",
			],
			analyze: TYPESCRIPT_JAVASCRIPT_ANALYZER.analyze,
		},
	],
	endpointExtractors: [
		{
			id: "endpoint.typescript.generic",
			pluginId: PLUGIN_ID,
			extensions: [".ts", ".tsx", ".js", ".jsx"],
			frameworks: ["javascript-http"],
			extract(source) {
				return extractJavaScriptTypeScriptEndpoints(source).filter(
					(endpoint) => endpoint.framework === "javascript-http",
				);
			},
		},
	],
	semgrepRules: [
		{
			pluginId: PLUGIN_ID,
			rulesetId: "curated-sast-v1",
			path: "typescript/owned-core.yml",
			digest:
				"sha256:a0849638801c67f8fcae4d10fb3086ddff28215a77bac8984d759a6b4aae9129",
			language: "typescript",
		},
		{
			pluginId: PLUGIN_ID,
			rulesetId: "curated-sast-v1",
			path: "javascript/owned-core.yml",
			digest:
				"sha256:9a3037344ab8aa04c33e797a4bd434798862596d1fce8381d875a97990327854",
			language: "javascript",
		},
	],
	startPlanners: [],
};
