import type {
	ScanProfile,
	ScanProfileStep,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";
import { buildPluginDependencyManifestScope } from "./plugin-dependency-scope";

export const SOURCE_BASELINE_SCOPE: ScanScopePolicy = {
	intent: "source",
	includeGlobs: ["**/*"],
	excludeGlobs: [
		"node_modules/**",
		"dist/**",
		"dist-web/**",
		"build/**",
		"coverage/**",
		"artifacts/**",
	],
	includeGenerated: false,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
	notes:
		"Scans first-party source, configuration, manifests, and lockfiles while excluding generated output and installed dependencies.",
};

export const DEPENDENCY_MANIFEST_SCOPE: ScanScopePolicy =
	buildPluginDependencyManifestScope();

export const ARTIFACT_SCOPE: ScanScopePolicy = {
	intent: "artifact",
	includeGlobs: ["dist/**", "dist-web/**", "build/**", "*.map", "**/*.map"],
	excludeGlobs: ["node_modules/**", "artifacts/**"],
	includeGenerated: true,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
	notes:
		"Scans deployable build output and source maps without treating node_modules as part of the artifact by default.",
};

export const FULL_DEEP_SCOPE: ScanScopePolicy = {
	intent: "full_deep",
	includeGlobs: ["**/*"],
	excludeGlobs: ["artifacts/**"],
	includeGenerated: true,
	includeInstalledDependencies: true,
	includeVendoredDependencies: true,
	notes:
		"Broad audit profile for generated output, vendored code, and installed dependency trees.",
};

export function staticProfileSteps(
	profile: Pick<ScanProfile, "tools">,
): ScanProfileStep[] {
	return profile.tools.map((tool) => ({ kind: "static_tool", ...tool }));
}
