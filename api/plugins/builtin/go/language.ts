import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { GO_SOURCE_ANALYZER } from "../../../modules/static-intelligence/project-structure/analyzers/go";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "language.go";

export const goLanguagePlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "language",
		displayName: "Go",
		requires: { allOf: [], oneOf: [] },
		declaredCapabilities: ["source_detection", "sast", "project_structure"],
	},
	detectors: [
		pathDetector({
			id: "detect.language.go",
			pluginId: PLUGIN_ID,
			globs: ["**/*.go"],
			kind: "extension",
		}),
	],
	dependencyProviders: [],
	sourceAnalyzers: [
		{
			id: "go-source",
			pluginId: PLUGIN_ID,
			version: "1",
			extensions: [".go"],
			coverageEffect: "partial",
			limitationCodes: [
				"go_bounded_lexical_analysis",
				"go_build_constraints_partial",
				"go_type_checking_not_performed",
			],
			analyze: GO_SOURCE_ANALYZER.analyze,
		},
	],
	endpointExtractors: [],
	semgrepRules: [
		{
			pluginId: PLUGIN_ID,
			rulesetId: "curated-sast-v1",
			path: "go/owned-core.yml",
			digest:
				"sha256:a6caaa0a915664b4b6545d5bb3080e9b427034f1a932f30cd7f32eb85d1146a6",
			language: "go",
		},
	],
	startPlanners: [],
};
