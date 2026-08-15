import type {
	DiffManifest,
	DiffToolApplicability,
} from "../../../shared/schemas/scan-target.schema";
import { matchesAnyPluginGlob } from "../project-capabilities/path-patterns";
import {
	dependencyProvidersForPaths,
	detectAffectedPluginsFromPaths,
} from "../project-capabilities/plugin-detector";

const DEPENDENCY_PLUGIN_LABELS = new Map<string, string>([
	["build.go-modules", "Go modules"],
	["build.gradle", "Gradle dependencies"],
	["build.maven", "Maven dependencies"],
	["build.npm", "npm dependencies"],
	["build.python-requirements", "Python requirements"],
]);

export type DependencyChangeObservation = {
	dependencyStateChanged: boolean;
	lockStateChanged: boolean;
	affectedEcosystems: string[];
	covered: string[];
	gaps: string[];
	limitationCodes: string[];
};

export function observeDependencyChange(params: {
	manifest: DiffManifest;
	toolApplicability: readonly DiffToolApplicability[];
}): DependencyChangeObservation {
	const pluginContext = params.manifest.pluginContext;
	const scanPaths = params.manifest.entries
		.filter((entry) => entry.disposition === "scan")
		.map((entry) => entry.path);
	const affectedPluginIds = detectAffectedPluginsFromPaths(scanPaths);
	const dependencyProviders = dependencyProvidersForPaths(scanPaths);
	const dependencyStateChanged = dependencyProviders.length > 0;
	const lockStateChanged = dependencyProviders.some((provider) =>
		scanPaths.some((candidate) =>
			matchesAnyPluginGlob(candidate, provider.lockGlobs),
		),
	);
	const affectedEcosystems = canonicalStrings(
		affectedPluginIds.flatMap((pluginId) => {
			const label = DEPENDENCY_PLUGIN_LABELS.get(pluginId);
			return label ? [label] : [];
		}),
	);
	const covered = [
		"Dependency change applicability from the saved diff manifest",
	];
	const gaps: string[] = [];
	const limitationCodes = [...pluginContext.limitationCodes];

	if (!dependencyStateChanged) {
		gaps.push("No dependency manifest or lock-state change was observed");
		limitationCodes.push("dependency_change_not_observed");
	} else {
		covered.push(
			lockStateChanged
				? "Dependency manifest and lock-state changes"
				: "Dependency manifest changes",
		);
		for (const ecosystem of affectedEcosystems) {
			covered.push(`${ecosystem} change scope`);
		}
		if (affectedEcosystems.length === 0) {
			gaps.push("Dependency ecosystem could not be classified");
			limitationCodes.push("dependency_ecosystem_unclassified");
		}
	}

	addDiffCoverageLimitations(params.manifest, gaps, limitationCodes);
	addToolCoverageLimitations(params.toolApplicability, gaps, limitationCodes);

	return {
		dependencyStateChanged,
		lockStateChanged,
		affectedEcosystems,
		covered: canonicalStrings(covered),
		gaps: canonicalStrings(gaps),
		limitationCodes: canonicalStrings(limitationCodes),
	};
}

function addDiffCoverageLimitations(
	manifest: DiffManifest,
	gaps: string[],
	limitationCodes: string[],
): void {
	const { coverage } = manifest;
	if (coverage.unsupported > 0) {
		gaps.push("Unsupported changed paths were not inspected");
		limitationCodes.push("diff_contains_unsupported_paths");
	}
	if (coverage.tooLarge > 0) {
		gaps.push("Oversized changed paths were not inspected");
		limitationCodes.push("diff_contains_oversized_paths");
	}
	if (coverage.excluded > 0) {
		gaps.push("Profile-excluded changed paths were not inspected");
		limitationCodes.push("diff_contains_excluded_paths");
	}
}

function addToolCoverageLimitations(
	toolApplicability: readonly DiffToolApplicability[],
	gaps: string[],
	limitationCodes: string[],
): void {
	for (const tool of toolApplicability) {
		if (tool.toolId !== "osv" && tool.toolId !== "trivy") continue;
		if (tool.coverageEffect === "partial") {
			gaps.push(`${toolLabel(tool.toolId)} dependency coverage was partial`);
			limitationCodes.push(`${tool.toolId}_dependency_coverage_partial`);
		}
		if (tool.coverageEffect === "gap") {
			gaps.push(`${toolLabel(tool.toolId)} dependency coverage had a gap`);
			limitationCodes.push(`${tool.toolId}_dependency_coverage_gap`);
		}
		if (tool.reasonCode) limitationCodes.push(tool.reasonCode);
	}
}

export function toolLabel(toolId: "osv" | "trivy"): string {
	return toolId === "osv" ? "OSV" : "Trivy";
}

function canonicalStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort(compareCodeUnits);
}

function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
