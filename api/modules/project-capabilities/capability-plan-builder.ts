import {
	projectCapabilityPlanV1Schema,
	type ProjectCapabilityPlanV1,
	type ProjectCapabilityStepV1,
} from "../../../shared/schemas/project-capability-plan.schema";
import type { ProjectPluginDetection } from "../../../shared/schemas/technology-plugin.schema";
import type { PluginContext, TechnologyPluginV1 } from "./plugin-contract";
import type { TechnologyPluginRegistry } from "./plugin-registry";
import { preferredStartPlans } from "./start-plan-selection";

export async function buildProjectCapabilityPlan(params: {
	context: PluginContext;
	detections: ProjectPluginDetection[];
	activePlugins: TechnologyPluginV1[];
	registry: TechnologyPluginRegistry;
}): Promise<ProjectCapabilityPlanV1> {
	const activeIds = params.activePlugins.map((plugin) => plugin.manifest.id);
	const paths = params.context.inventory.map((entry) => entry.path);
	const languagePlugins = params.activePlugins.filter(
		(plugin) => plugin.manifest.kind === "language",
	);
	const buildPlugins = params.activePlugins.filter(
		(plugin) => plugin.manifest.kind === "build_system",
	);
	const frameworkPlugins = params.activePlugins.filter(
		(plugin) => plugin.manifest.kind === "framework",
	);
	const steps: ProjectCapabilityStepV1[] = [];
	if (languagePlugins.length > 0) {
		steps.push({
			stepId: "semgrep",
			pluginIds: languagePlugins
				.filter((plugin) => plugin.semgrepRules.length > 0)
				.map((plugin) => plugin.manifest.id),
			applicability: "applicable",
			reasonCode: null,
			coverageEffect: "covered",
			limitationCodes: [],
		});
		steps.push({
			stepId: "project_structure",
			pluginIds: languagePlugins.map((plugin) => plugin.manifest.id),
			applicability: "applicable",
			reasonCode:
				languagePlugins
					.flatMap((plugin) => plugin.sourceAnalyzers)
					.flatMap((analyzer) => analyzer.limitationCodes ?? [])[0] ?? null,
			coverageEffect: worstCapabilityCoverage(
				languagePlugins.flatMap((plugin) =>
					plugin.sourceAnalyzers.map(
						(analyzer) => analyzer.coverageEffect ?? "covered",
					),
				),
			),
			limitationCodes: [
				...new Set(
					languagePlugins
						.flatMap((plugin) => plugin.sourceAnalyzers)
						.flatMap((analyzer) => analyzer.limitationCodes ?? []),
				),
			].sort(),
		});
	}
	for (const plugin of buildPlugins) {
		for (const provider of plugin.dependencyProviders) {
			const coverage = provider.coverage(paths);
			steps.push({
				stepId: `dependency:${provider.id}`,
				pluginIds: [plugin.manifest.id],
				applicability: "applicable",
				reasonCode: coverage.reasonCode,
				coverageEffect: coverage.coverageEffect,
				limitationCodes: coverage.limitationCodes,
			});
		}
	}
	if (frameworkPlugins.length > 0) {
		steps.push({
			stepId: "endpoint_extraction",
			pluginIds: frameworkPlugins.map((plugin) => plugin.manifest.id),
			applicability: "applicable",
			reasonCode: null,
			coverageEffect: worstCapabilityCoverage(
				frameworkPlugins.flatMap((plugin) =>
					plugin.endpointExtractors.map(
						(extractor) => extractor.coverageEffect ?? "covered",
					),
				),
			),
			limitationCodes: [
				...new Set([
					...params.detections
						.filter((detection) =>
							frameworkPlugins.some(
								(plugin) => plugin.manifest.id === detection.pluginId,
							),
						)
						.flatMap((detection) => detection.limitations),
					...frameworkPlugins
						.flatMap((plugin) => plugin.endpointExtractors)
						.flatMap((extractor) => extractor.limitationCodes ?? []),
				]),
			].sort(),
		});
	}
	const startPlans = (
		await Promise.all(
			params.activePlugins.flatMap((plugin) =>
				plugin.startPlanners.map((planner) =>
					planner.plan({
						...params.context,
						port: 3000,
						requestedPortExplicit: false,
						activePluginIds: activeIds,
					}),
				),
			),
		)
	).filter((plan) => plan !== null);
	const preferredPlans = preferredStartPlans(startPlans);
	const startPlanAmbiguous = preferredPlans.length > 1;
	const selectedPlans = startPlanAmbiguous ? [] : preferredPlans;
	const sandboxRequired = selectedPlans.some(
		(plan) => plan.requiresProjectCodeConsent,
	);
	steps.push({
		stepId: "dast_start",
		pluginIds: [
			...new Set(
				(startPlanAmbiguous ? preferredPlans : selectedPlans).map(
					(plan) => plan.pluginId,
				),
			),
		],
		applicability: selectedPlans.length > 0 ? "applicable" : "not_applicable",
		reasonCode:
			selectedPlans.length === 0
				? "target_start_not_supported"
				: sandboxRequired
					? "project_code_execution_sandbox_required"
					: null,
		coverageEffect:
			selectedPlans.length > 0 && !sandboxRequired ? "covered" : "gap",
		limitationCodes: startPlanAmbiguous
			? ["target_start_ambiguous"]
			: selectedPlans.length === 0
				? ["target_start_not_supported"]
				: sandboxRequired
					? ["project_code_execution_sandbox_required"]
					: [],
	});
	return projectCapabilityPlanV1Schema.parse({
		schemaVersion: 1,
		registryDigest: params.registry.registryDigest,
		activePluginIds: activeIds,
		languages: languagePlugins.map((plugin) =>
			plugin.manifest.id.slice("language.".length),
		),
		buildSystems: buildPlugins.map((plugin) =>
			plugin.manifest.id.slice("build.".length),
		),
		frameworks: frameworkPlugins.map((plugin) => plugin.manifest.id),
		steps,
	});
}

export function worstCapabilityCoverage(
	values: Array<"covered" | "partial" | "gap">,
): "covered" | "partial" | "gap" {
	if (values.includes("gap")) return "gap";
	if (values.includes("partial")) return "partial";
	return "covered";
}
