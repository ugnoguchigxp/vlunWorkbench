import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "build.maven";
const POM_GLOBS = ["pom.xml", "**/pom.xml"] as const;

export const mavenBuildPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "build_system",
		displayName: "Maven",
		requires: { allOf: ["language.java"], oneOf: [] },
		declaredCapabilities: ["dependency_detection", "dependency_scan"],
	},
	detectors: [
		pathDetector({
			id: "detect.build.maven",
			pluginId: PLUGIN_ID,
			globs: POM_GLOBS,
			kind: "manifest",
		}),
	],
	dependencyProviders: [
		{
			id: "dependency.maven",
			pluginId: PLUGIN_ID,
			ecosystem: "Maven",
			primaryGlobs: POM_GLOBS,
			lockGlobs: [],
			companionGlobs: [],
			excludeGlobs: ["target/**", "**/target/**"],
			coverage() {
				return {
					coverageEffect: "partial",
					reasonCode: "maven_direct_dependencies_only",
					limitationCodes: [
						"direct_dependencies",
						"dependency_resolution_not_performed",
					],
				};
			},
		},
	],
	sourceAnalyzers: [],
	endpointExtractors: [],
	semgrepRules: [],
	startPlanners: [],
};
