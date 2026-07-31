import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { JAVA_SOURCE_ANALYZER } from "../../../modules/static-intelligence/project-structure/analyzers/java";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "language.java";

export const javaLanguagePlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "language",
		displayName: "Java",
		requires: { allOf: [], oneOf: [] },
		declaredCapabilities: ["source_detection", "sast", "project_structure"],
	},
	detectors: [
		pathDetector({
			id: "detect.language.java",
			pluginId: PLUGIN_ID,
			globs: ["**/*.java"],
			kind: "extension",
		}),
	],
	dependencyProviders: [],
	sourceAnalyzers: [
		{
			id: "java-source",
			pluginId: PLUGIN_ID,
			version: "1",
			extensions: [".java"],
			analyze: JAVA_SOURCE_ANALYZER.analyze,
		},
	],
	endpointExtractors: [],
	semgrepRules: [
		{
			pluginId: PLUGIN_ID,
			rulesetId: "curated-sast-v1",
			path: "java/owned-core.yml",
			digest:
				"sha256:fa0e42bfec4528e29410f76e100b330a20f5e3bfe8d2f2c22e505379c96fdf7a",
			language: "java",
		},
	],
	startPlanners: [],
};
