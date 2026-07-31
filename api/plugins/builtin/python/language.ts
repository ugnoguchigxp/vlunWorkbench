import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { PYTHON_SOURCE_ANALYZER } from "../../../modules/static-intelligence/project-structure/analyzers/python";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "language.python";

export const pythonLanguagePlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "language",
		displayName: "Python",
		requires: { allOf: [], oneOf: [] },
		declaredCapabilities: ["source_detection", "sast", "project_structure"],
	},
	detectors: [
		pathDetector({
			id: "detect.language.python",
			pluginId: PLUGIN_ID,
			globs: ["**/*.py"],
			kind: "extension",
		}),
	],
	dependencyProviders: [],
	sourceAnalyzers: [
		{
			id: "python-source",
			pluginId: PLUGIN_ID,
			version: "1",
			extensions: [".py", ".pyi"],
			coverageEffect: "partial",
			limitationCodes: [
				"python_bounded_lexical_analysis",
				"python_dynamic_import_not_resolved",
				"python_namespace_packages_partial",
			],
			analyze: PYTHON_SOURCE_ANALYZER.analyze,
		},
	],
	endpointExtractors: [],
	semgrepRules: [
		{
			pluginId: PLUGIN_ID,
			rulesetId: "curated-sast-v1",
			path: "python/owned-core.yml",
			digest:
				"sha256:ff8574338dbec9bb4db5784738b79d69bd655911d5e8da9aa9eeaa08d246df84",
			language: "python",
		},
	],
	startPlanners: [],
};
