import type { TechnologyPluginV1 } from "../../../modules/project-capabilities/plugin-contract";
import { matchesAnyPluginGlob } from "../../../modules/project-capabilities/path-patterns";
import { pathDetector } from "../helpers";

const PLUGIN_ID = "build.gradle";
export const GRADLE_LOCK_GLOBS = [
	"gradle.lockfile",
	"**/gradle.lockfile",
	"buildscript-gradle.lockfile",
	"**/buildscript-gradle.lockfile",
	"*gradle.lockfile",
	"**/*gradle.lockfile",
] as const;
export const GRADLE_VERIFICATION_GLOBS = [
	"gradle/verification-metadata.xml",
	"**/gradle/verification-metadata.xml",
] as const;
export const GRADLE_COMPANION_GLOBS = [
	"build.gradle",
	"build.gradle.kts",
	"settings.gradle",
	"settings.gradle.kts",
	"gradle/libs.versions.toml",
	"**/build.gradle",
	"**/build.gradle.kts",
	"**/settings.gradle",
	"**/settings.gradle.kts",
	"**/gradle/libs.versions.toml",
	"gradlew",
	"gradlew.bat",
	"gradle/wrapper/gradle-wrapper.properties",
] as const;

export const gradleBuildPlugin: TechnologyPluginV1 = {
	manifest: {
		schemaVersion: 1,
		pluginApiVersion: "1",
		id: PLUGIN_ID,
		version: "1.0.0",
		kind: "build_system",
		displayName: "Gradle",
		requires: { allOf: ["language.java"], oneOf: [] },
		declaredCapabilities: ["dependency_detection", "dependency_scan"],
	},
	detectors: [
		pathDetector({
			id: "detect.build.gradle",
			pluginId: PLUGIN_ID,
			globs: [
				...GRADLE_LOCK_GLOBS,
				...GRADLE_VERIFICATION_GLOBS,
				...GRADLE_COMPANION_GLOBS,
			],
			kind: "manifest",
		}),
	],
	dependencyProviders: [
		{
			id: "dependency.gradle",
			pluginId: PLUGIN_ID,
			ecosystem: "Maven",
			primaryGlobs: [...GRADLE_LOCK_GLOBS, ...GRADLE_VERIFICATION_GLOBS],
			lockGlobs: GRADLE_LOCK_GLOBS,
			companionGlobs: GRADLE_COMPANION_GLOBS,
			excludeGlobs: [".gradle/**", "**/.gradle/**", "build/**", "**/build/**"],
			coverage(paths) {
				if (
					paths.some((value) => matchesAnyPluginGlob(value, GRADLE_LOCK_GLOBS))
				) {
					return {
						coverageEffect: "covered",
						reasonCode: null,
						limitationCodes: [],
					};
				}
				if (
					paths.some((value) =>
						matchesAnyPluginGlob(value, GRADLE_VERIFICATION_GLOBS),
					)
				) {
					return {
						coverageEffect: "partial",
						reasonCode: "gradle_verification_metadata_only",
						limitationCodes: ["verification_metadata"],
					};
				}
				return {
					coverageEffect: "gap",
					reasonCode: "gradle_dependency_lock_missing",
					limitationCodes: ["gradle_dependency_lock_missing"],
				};
			},
		},
	],
	sourceAnalyzers: [],
	endpointExtractors: [],
	semgrepRules: [],
	startPlanners: [],
};
