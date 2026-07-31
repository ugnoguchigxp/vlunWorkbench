import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import { builtInTechnologyPluginRegistry } from "../../plugins/builtin";

export function buildPluginDependencyManifestScope(): ScanScopePolicy {
	const providers = builtInTechnologyPluginRegistry.dependencyProviders();
	return {
		intent: "dependency_manifest",
		includeGlobs: uniqueSorted(
			providers.flatMap((provider) => [
				...provider.primaryGlobs,
				...provider.companionGlobs,
			]),
		),
		excludeGlobs: uniqueSorted(
			providers.flatMap((provider) => provider.excludeGlobs),
		),
		includeGenerated: false,
		includeInstalledDependencies: false,
		includeVendoredDependencies: false,
		notes:
			"Plugin-derived dependency manifests, resolved lock inputs, and bounded companion files; installed dependency trees and build outputs remain excluded.",
	};
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
