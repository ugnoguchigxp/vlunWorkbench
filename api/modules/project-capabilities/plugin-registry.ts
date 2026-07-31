import crypto from "node:crypto";
import { technologyPluginManifestV1Schema } from "../../../shared/schemas/technology-plugin.schema";
import type {
	DependencyProvider,
	EndpointExtractorContribution,
	ProjectDetector,
	SemgrepRuleContribution,
	SourceAnalyzerContribution,
	StartPlanner,
	TechnologyPluginV1,
} from "./plugin-contract";
import type { TechnologyPluginCapability } from "../../../shared/schemas/technology-plugin.schema";
import { isSafeRelativePluginPath } from "./path-patterns";

const SUPPORTED_PLUGIN_API_VERSION = "1";

export class TechnologyPluginRegistry {
	readonly registryDigest: `sha256:${string}`;
	private readonly orderedPlugins: TechnologyPluginV1[];
	private readonly pluginsById: Map<string, TechnologyPluginV1>;

	constructor(plugins: readonly TechnologyPluginV1[]) {
		this.pluginsById = validateAndIndexPlugins(plugins);
		this.orderedPlugins = resolvePluginOrder(this.pluginsById);
		assertRequirementsSatisfiable(this.orderedPlugins);
		this.registryDigest = `sha256:${crypto
			.createHash("sha256")
			.update(canonicalJson(this.digestInput()))
			.digest("hex")}`;
	}

	plugins(): readonly TechnologyPluginV1[] {
		return this.orderedPlugins;
	}

	get(pluginId: string): TechnologyPluginV1 | undefined {
		return this.pluginsById.get(pluginId);
	}

	detectors(): readonly ProjectDetector[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.detectors);
	}

	dependencyProviders(): readonly DependencyProvider[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.dependencyProviders);
	}

	sourceAnalyzers(): readonly SourceAnalyzerContribution[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.sourceAnalyzers);
	}

	endpointExtractors(): readonly EndpointExtractorContribution[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.endpointExtractors);
	}

	semgrepRules(): readonly SemgrepRuleContribution[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.semgrepRules);
	}

	startPlanners(): readonly StartPlanner[] {
		return this.orderedPlugins.flatMap((plugin) => plugin.startPlanners);
	}

	private digestInput() {
		return this.orderedPlugins.map((plugin) => ({
			manifest: plugin.manifest,
			detectors: plugin.detectors.map((item) => ({
				id: item.id,
				fileGlobs: [...item.fileGlobs],
				exclusiveGroup: item.exclusiveGroup ?? null,
				priority: item.priority ?? 0,
			})),
			dependencyProviders: plugin.dependencyProviders.map((item) => ({
				id: item.id,
				ecosystem: item.ecosystem,
				primaryGlobs: [...item.primaryGlobs],
				lockGlobs: [...item.lockGlobs],
				companionGlobs: [...item.companionGlobs],
				excludeGlobs: [...item.excludeGlobs],
			})),
			sourceAnalyzers: plugin.sourceAnalyzers.map((item) => ({
				id: item.id,
				pluginId: item.pluginId,
				version: item.version,
				extensions: [...item.extensions],
			})),
			endpointExtractors: plugin.endpointExtractors.map((item) => ({
				id: item.id,
				extensions: [...item.extensions],
				frameworks: [...item.frameworks],
			})),
			semgrepRules: plugin.semgrepRules,
			startPlanners: plugin.startPlanners.map((item) => ({ id: item.id })),
		}));
	}
}

export function registerBuiltInPlugins(
	plugins: readonly TechnologyPluginV1[],
): TechnologyPluginRegistry {
	return new TechnologyPluginRegistry(plugins);
}

function validateAndIndexPlugins(
	plugins: readonly TechnologyPluginV1[],
): Map<string, TechnologyPluginV1> {
	const byId = new Map<string, TechnologyPluginV1>();
	const detectorIds = new Set<string>();
	const dependencyProviderIds = new Set<string>();
	const analyzerIds = new Set<string>();
	const primaryManifestClaims = new Set<string>();
	const endpointExtractorIds = new Set<string>();
	const semgrepAssetClaims = new Set<string>();
	const startPlannerIds = new Set<string>();
	const exclusivePriorities = new Set<string>();

	for (const plugin of plugins) {
		const manifest = technologyPluginManifestV1Schema.parse(plugin.manifest);
		if (manifest.pluginApiVersion !== SUPPORTED_PLUGIN_API_VERSION) {
			throw new Error(
				`unsupported_plugin_api_version:${manifest.id}:${manifest.pluginApiVersion}`,
			);
		}
		if (byId.has(manifest.id)) {
			throw new Error(`duplicate_plugin_id:${manifest.id}`);
		}
		byId.set(manifest.id, plugin);
		validateContributionOwners(plugin);
		validateDeclaredCapabilities(plugin);
		for (const detector of plugin.detectors) {
			assertUnique(detectorIds, detector.id, "duplicate_detector_id");
			if (detector.exclusiveGroup) {
				assertUnique(
					exclusivePriorities,
					`${detector.exclusiveGroup}:${detector.priority ?? 0}`,
					"ambiguous_exclusive_detector",
				);
			}
		}
		for (const analyzer of plugin.sourceAnalyzers) {
			assertUnique(analyzerIds, analyzer.id, "duplicate_analyzer_ownership");
		}
		for (const provider of plugin.dependencyProviders) {
			assertUnique(
				dependencyProviderIds,
				provider.id,
				"duplicate_dependency_provider_id",
			);
			for (const glob of provider.primaryGlobs) {
				assertUnique(
					primaryManifestClaims,
					glob,
					"duplicate_primary_manifest_claim",
				);
			}
		}
		for (const extractor of plugin.endpointExtractors) {
			assertUnique(
				endpointExtractorIds,
				extractor.id,
				"duplicate_endpoint_extractor_id",
			);
		}
		for (const planner of plugin.startPlanners) {
			assertUnique(startPlannerIds, planner.id, "start_planner_id_collision");
		}
		for (const contribution of plugin.semgrepRules) {
			assertUnique(
				semgrepAssetClaims,
				contribution.path,
				"duplicate_semgrep_asset_claim",
			);
			if (!/^sha256:[a-f0-9]{64}$/.test(contribution.digest)) {
				throw new Error(
					`semgrep_rule_contribution_missing_digest:${manifest.id}`,
				);
			}
			if (!isSafeRelativePluginPath(contribution.path)) {
				throw new Error(`plugin_asset_path_invalid:${manifest.id}`);
			}
		}
	}

	for (const plugin of plugins) {
		const { allOf, oneOf } = plugin.manifest.requires;
		for (const dependency of allOf) {
			if (!byId.has(dependency)) {
				throw new Error(
					`missing_required_plugin:${plugin.manifest.id}:${dependency}`,
				);
			}
		}
		if (oneOf.length > 0 && !oneOf.some((dependency) => byId.has(dependency))) {
			throw new Error(`missing_required_plugin:${plugin.manifest.id}:one_of`);
		}
	}
	return byId;
}

function validateContributionOwners(plugin: TechnologyPluginV1): void {
	const contributions: Array<{ pluginId: string }> = [
		...plugin.detectors,
		...plugin.dependencyProviders,
		...plugin.sourceAnalyzers,
		...plugin.endpointExtractors,
		...plugin.semgrepRules,
		...plugin.startPlanners,
	];
	for (const contribution of contributions) {
		if (contribution.pluginId !== plugin.manifest.id) {
			throw new Error(
				`plugin_contribution_owner_mismatch:${plugin.manifest.id}:${contribution.pluginId}`,
			);
		}
	}
}

function validateDeclaredCapabilities(plugin: TechnologyPluginV1): void {
	const declared = new Set(plugin.manifest.declaredCapabilities);
	const requirements: Array<{
		present: boolean;
		capabilities: readonly TechnologyPluginCapability[];
	}> = [
		{
			present: plugin.dependencyProviders.length > 0,
			capabilities: ["dependency_detection", "dependency_scan"],
		},
		{
			present: plugin.sourceAnalyzers.length > 0,
			capabilities: ["project_structure"],
		},
		{
			present: plugin.endpointExtractors.length > 0,
			capabilities: ["endpoint_extraction"],
		},
		{ present: plugin.semgrepRules.length > 0, capabilities: ["sast"] },
		{ present: plugin.startPlanners.length > 0, capabilities: ["dast_start"] },
	];
	for (const requirement of requirements) {
		if (!requirement.present) continue;
		for (const capability of requirement.capabilities) {
			if (!declared.has(capability)) {
				throw new Error(
					`plugin_capability_not_declared:${plugin.manifest.id}:${capability}`,
				);
			}
		}
	}
}

function resolvePluginOrder(
	pluginsById: Map<string, TechnologyPluginV1>,
): TechnologyPluginV1[] {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const output: TechnologyPluginV1[] = [];
	const visit = (pluginId: string) => {
		if (visited.has(pluginId)) return;
		if (visiting.has(pluginId)) {
			throw new Error(`plugin_dependency_cycle:${pluginId}`);
		}
		visiting.add(pluginId);
		const plugin = pluginsById.get(pluginId);
		if (!plugin) throw new Error(`missing_required_plugin:${pluginId}`);
		const dependencies = [...plugin.manifest.requires.allOf].sort(
			(left, right) => left.localeCompare(right),
		);
		for (const dependency of dependencies) visit(dependency);
		visiting.delete(pluginId);
		visited.add(pluginId);
		output.push(plugin);
	};
	for (const pluginId of [...pluginsById.keys()].sort((left, right) =>
		left.localeCompare(right),
	)) {
		visit(pluginId);
	}
	return output;
}

function assertRequirementsSatisfiable(
	plugins: readonly TechnologyPluginV1[],
): void {
	const activeIds = new Set<string>();
	let changed = true;
	while (changed) {
		changed = false;
		for (const plugin of plugins) {
			if (activeIds.has(plugin.manifest.id)) continue;
			const allSatisfied = plugin.manifest.requires.allOf.every((dependency) =>
				activeIds.has(dependency),
			);
			const oneSatisfied =
				plugin.manifest.requires.oneOf.length === 0 ||
				plugin.manifest.requires.oneOf.some((dependency) =>
					activeIds.has(dependency),
				);
			if (allSatisfied && oneSatisfied) {
				activeIds.add(plugin.manifest.id);
				changed = true;
			}
		}
	}
	const impossible = plugins.find(
		(plugin) => !activeIds.has(plugin.manifest.id),
	);
	if (impossible) {
		throw new Error(`plugin_dependency_cycle:${impossible.manifest.id}`);
	}
}

function assertUnique(
	values: Set<string>,
	value: string,
	errorCode: string,
): void {
	if (values.has(value)) throw new Error(`${errorCode}:${value}`);
	values.add(value);
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonicalize(item)]),
		);
	}
	return value;
}
