import { describe, expect, it } from "bun:test";
import type { TechnologyPluginV1 } from "./plugin-contract";
import { activePluginsForDetections } from "./plugin-detector";
import {
	registerBuiltInPlugins,
	TechnologyPluginRegistry,
} from "./plugin-registry";

describe("technology plugin registry", () => {
	it("orders plugins deterministically and produces a stable digest", () => {
		const language = plugin("language.fixture");
		const build = plugin("build.fixture", {
			allOf: ["language.fixture"],
			oneOf: [],
		});
		const first = registerBuiltInPlugins([build, language]);
		const second = registerBuiltInPlugins([language, build]);

		expect(first.plugins().map((item) => item.manifest.id)).toEqual([
			"language.fixture",
			"build.fixture",
		]);
		expect(first.registryDigest).toBe(second.registryDigest);
	});

	it("rejects duplicate ids, missing dependencies, and cycles", () => {
		const fixture = plugin("language.fixture");
		expect(() => new TechnologyPluginRegistry([fixture, fixture])).toThrow(
			"duplicate_plugin_id",
		);
		expect(() =>
			new TechnologyPluginRegistry([
				plugin("build.fixture", {
					allOf: ["language.missing"],
					oneOf: [],
				}),
			]),
		).toThrow("missing_required_plugin");
		expect(() =>
			new TechnologyPluginRegistry([
				plugin("language.first", {
					allOf: ["language.second"],
					oneOf: [],
				}),
				plugin("language.second", {
					allOf: ["language.first"],
					oneOf: [],
				}),
			]),
		).toThrow("plugin_dependency_cycle");
	});

	it("accepts oneOf alternatives when one valid branch breaks an optional cycle", () => {
		const optional = plugin("language.optional", {
			allOf: [],
			oneOf: ["language.cyclic", "language.independent"],
		});
		const cyclic = plugin("language.cyclic", {
			allOf: ["language.optional"],
			oneOf: [],
		});
		const independent = plugin("language.independent");
		const registry = new TechnologyPluginRegistry([
			optional,
			cyclic,
			independent,
		]);
		const detections = registry.plugins().map((item) => ({
			pluginId: item.manifest.id,
			detected: true,
			confidence: "high" as const,
			evidence: [],
			limitations: [],
		}));

		expect(
			activePluginsForDetections(detections, registry).map(
				(item) => item.manifest.id,
			),
		).toEqual(
			expect.arrayContaining([
				"language.optional",
				"language.cyclic",
				"language.independent",
			]),
		);
	});

	it("rejects an unsatisfiable oneOf-only cycle", () => {
		expect(
			() =>
				new TechnologyPluginRegistry([
					plugin("language.first", {
						allOf: [],
						oneOf: ["language.second"],
					}),
					plugin("language.second", {
						allOf: [],
						oneOf: ["language.first"],
					}),
				]),
		).toThrow("plugin_dependency_cycle");
	});

	it("rejects API mismatches and unsafe Semgrep asset paths", () => {
		const incompatible = plugin("language.fixture");
		(incompatible.manifest as { pluginApiVersion: string }).pluginApiVersion =
			"2";
		expect(() => new TechnologyPluginRegistry([incompatible])).toThrow();

		const unsafe = plugin("language.unsafe");
		unsafe.manifest.declaredCapabilities.push("sast");
		unsafe.semgrepRules = [
			{
				pluginId: "language.unsafe",
				rulesetId: "fixture",
				path: "../outside.yml",
				digest: `sha256:${"a".repeat(64)}`,
				language: "fixture",
			},
		];
		expect(() => new TechnologyPluginRegistry([unsafe])).toThrow(
			"plugin_asset_path_invalid",
		);
	});

	it("rejects contribution ownership and identifier collisions", () => {
		const first = plugin("language.first");
		first.manifest.declaredCapabilities.push("endpoint_extraction");
		first.endpointExtractors = [
			{
				id: "endpoint.fixture",
				pluginId: "language.first",
				extensions: [".fixture"],
				frameworks: ["fixture"],
				extract: () => [],
			},
		];
		const second = plugin("language.second");
		second.manifest.declaredCapabilities.push("endpoint_extraction");
		second.endpointExtractors = [
			{
				id: "endpoint.fixture",
				pluginId: "language.second",
				extensions: [".second"],
				frameworks: ["second"],
				extract: () => [],
			},
		];
		expect(() => new TechnologyPluginRegistry([first, second])).toThrow(
			"duplicate_endpoint_extractor_id",
		);

		const wrongOwner = plugin("language.owner");
		wrongOwner.detectors = [
			{
				id: "detect.wrong-owner",
				pluginId: "language.other",
				fileGlobs: ["**/*.fixture"],
				detect: () => ({
					detected: false,
					confidence: "low",
					evidence: [],
					limitations: [],
				}),
			},
		];
		expect(() => new TechnologyPluginRegistry([wrongOwner])).toThrow(
			"plugin_contribution_owner_mismatch",
		);
	});

	it("rejects duplicate dependency providers and Semgrep assets", () => {
		const first = plugin("language.first");
		first.manifest.declaredCapabilities.push("sast");
		first.semgrepRules = [
			{
				pluginId: "language.first",
				rulesetId: "fixture",
				path: "fixture/rules.yml",
				digest: `sha256:${"a".repeat(64)}`,
				language: "fixture",
			},
		];
		const second = plugin("language.second");
		second.manifest.declaredCapabilities.push("sast");
		second.semgrepRules = [
			{
				pluginId: "language.second",
				rulesetId: "second",
				path: "fixture/rules.yml",
				digest: `sha256:${"b".repeat(64)}`,
				language: "second",
			},
		];
		expect(() => new TechnologyPluginRegistry([first, second])).toThrow(
			"duplicate_semgrep_asset_claim",
		);

		const buildFirst = plugin("build.first");
		buildFirst.manifest.declaredCapabilities.push(
			"dependency_detection",
			"dependency_scan",
		);
		buildFirst.dependencyProviders = [dependencyProvider("build.first")];
		const buildSecond = plugin("build.second");
		buildSecond.manifest.declaredCapabilities.push(
			"dependency_detection",
			"dependency_scan",
		);
		buildSecond.dependencyProviders = [dependencyProvider("build.second")];
		expect(() =>
			new TechnologyPluginRegistry([buildFirst, buildSecond]),
		).toThrow("duplicate_dependency_provider_id");
	});

	it("rejects contributions missing their declared capability", () => {
		const fixture = plugin("language.fixture");
		fixture.sourceAnalyzers = [
			{
				id: "fixture",
				pluginId: "language.fixture",
				version: "1",
				extensions: [".fixture"],
				analyze: () => ({
					analyzerId: "fixture",
					references: [],
					diagnosticCodes: [],
				}),
			},
		];

		expect(() => new TechnologyPluginRegistry([fixture])).toThrow(
			"plugin_capability_not_declared:language.fixture:project_structure",
		);
	});

	it("allows a test-only extension without changing registry code", () => {
		const fixture = plugin("language.fixture");
		fixture.detectors = [
			{
				id: "detect.language.fixture",
				pluginId: "language.fixture",
				fileGlobs: ["**/*.fixture"],
				detect(context) {
					const evidence = context.inventory
						.filter((entry) => entry.path.endsWith(".fixture"))
						.map((entry) => ({
							path: entry.path,
							kind: "extension" as const,
						}));
					return {
						detected: evidence.length > 0,
						confidence: "high",
						evidence,
						limitations: [],
					};
				},
			},
		];
		const registry = new TechnologyPluginRegistry([fixture]);
		expect(registry.detectors()[0]?.fileGlobs).toEqual(["**/*.fixture"]);
	});
});

function plugin(
	id: string,
	requires: TechnologyPluginV1["manifest"]["requires"] = {
		allOf: [],
		oneOf: [],
	},
): TechnologyPluginV1 {
	return {
		manifest: {
			schemaVersion: 1,
			pluginApiVersion: "1",
			id,
			version: "1.0.0",
			kind: id.startsWith("build.") ? "build_system" : "language",
			displayName: id,
			requires,
			declaredCapabilities: ["source_detection"],
		},
		detectors: [],
		dependencyProviders: [],
		sourceAnalyzers: [],
		endpointExtractors: [],
		semgrepRules: [],
		startPlanners: [],
	};
}

function dependencyProvider(
	pluginId: string,
): TechnologyPluginV1["dependencyProviders"][number] {
	return {
		id: "dependency.fixture",
		pluginId,
		ecosystem: "Maven",
		primaryGlobs: [`${pluginId}.lock`],
		lockGlobs: [`${pluginId}.lock`],
		companionGlobs: [],
		excludeGlobs: [],
		coverage: () => ({
			coverageEffect: "covered",
			reasonCode: null,
			limitationCodes: [],
		}),
	};
}
