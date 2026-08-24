import dependencyManifest from "../../../shared/manifests/scan-dependencies.v1.json";
import { scanDependencyManifestSchema } from "../../../shared/schemas/scan-dependency-manifest.schema";
import {
	type CanonicalProfileId,
	canonicalProfileIdSchema,
	type ScanProfileDefinition,
	scanProfileDefinitionSchema,
} from "../../../shared/schemas/scan-profile-definition.schema";
import { getCatalogEntry, SCAN_PROFILE_CATALOG } from "./profile-catalog";

type DefinitionSeed = Omit<
	ScanProfileDefinition,
	"availability" | "safetyClass"
>;

const fixture = (profileId: CanonicalProfileId) =>
	`scripts/scan-profile-qualification/fixtures/${profileId}.json`;

const SEEDS: DefinitionSeed[] = [
	{
		id: "change-gate",
		engineId: "repository",
		variants: [
			{
				id: "source-diff",
				stepIds: [
					"source:gitleaks",
					"source:osv",
					"source:trivy",
					"source:zizmor",
					"source:semgrep",
				],
				qualificationFixture: fixture("change-gate"),
			},
		],
		dependencyIds: [
			"scanner.gitleaks",
			"scanner.osv",
			"scanner.trivy",
			"scanner.zizmor",
			"scanner.semgrep",
			"resource.workspace",
		],
	},
	{
		id: "source-assurance",
		engineId: "repository",
		variants: [
			{
				id: "source-full",
				stepIds: [
					"source:gitleaks",
					"source:osv",
					"source:trivy",
					"source:zizmor",
					"source:semgrep",
				],
				qualificationFixture: fixture("source-assurance"),
			},
		],
		dependencyIds: [
			"scanner.gitleaks",
			"scanner.osv",
			"scanner.trivy",
			"scanner.zizmor",
			"scanner.semgrep",
			"resource.workspace",
		],
	},
	{
		id: "dependency-supply-chain",
		engineId: "supply-artifact",
		variants: [
			{
				id: "offline-attestation",
				stepIds: ["deps:osv", "sbom:trivy", "attestation:cosign"],
				qualificationFixture: fixture("dependency-supply-chain"),
				dependencyIds: [
					"scanner.osv",
					"scanner.trivy",
					"scanner.cosign",
					"resource.workspace",
				],
			},
			{
				id: "slsa-provenance",
				stepIds: ["deps:osv", "sbom:trivy", "attestation:slsa-verifier"],
				qualificationFixture: fixture("dependency-supply-chain"),
				dependencyIds: [
					"scanner.osv",
					"scanner.trivy",
					"scanner.slsa-verifier",
					"resource.workspace",
				],
			},
		],
		dependencyIds: [
			"scanner.osv",
			"scanner.trivy",
			"scanner.cosign",
			"scanner.slsa-verifier",
			"resource.workspace",
		],
	},
	{
		id: "release-artifact",
		engineId: "supply-artifact",
		variants: [
			{
				id: "filesystem-artifact",
				stepIds: ["artifact:gitleaks", "artifact:trivy"],
				qualificationFixture: fixture("release-artifact"),
			},
			{
				id: "container-image-ref",
				stepIds: ["image:trivy"],
				qualificationFixture: fixture("release-artifact"),
			},
			{
				id: "container-image-tar",
				stepIds: ["image:trivy"],
				qualificationFixture: fixture("release-artifact"),
			},
		],
		dependencyIds: [
			"scanner.gitleaks",
			"scanner.trivy",
			"docker.daemon",
			"resource.workspace",
		],
	},
	{
		id: "dynamic-verification",
		engineId: "isolated-code",
		variants: [
			{
				id: "builtin-test",
				stepIds: ["dynamic:test"],
				qualificationFixture: fixture("dynamic-verification"),
			},
		],
		dependencyIds: ["docker.daemon", "resource.workspace"],
	},
	{
		id: "sanitizer-fuzz-lab",
		engineId: "isolated-code",
		variants: [
			{
				id: "sanitizer",
				stepIds: ["dynamic:sanitizer"],
				qualificationFixture: fixture("sanitizer-fuzz-lab"),
			},
			{
				id: "fuzz",
				stepIds: ["dynamic:fuzz"],
				qualificationFixture: fixture("sanitizer-fuzz-lab"),
			},
		],
		dependencyIds: ["docker.daemon", "resource.workspace"],
	},
	{
		id: "custom-dynamic-lab",
		engineId: "isolated-code",
		variants: [
			{
				id: "configured",
				stepIds: ["dynamic:custom"],
				qualificationFixture: fixture("custom-dynamic-lab"),
			},
		],
		dependencyIds: ["docker.daemon", "resource.workspace"],
	},
	{
		id: "runtime-passive",
		engineId: "passive-runtime",
		variants: [
			{
				id: "auto-project-runtime",
				stepIds: [
					"dast:web-passive-standard",
					"runtime:nuclei-safe",
					"runtime:zap-baseline",
				],
				qualificationFixture: fixture("runtime-passive"),
			},
		],
		dependencyIds: [
			"docker.daemon",
			"scanner.nuclei",
			"scanner.zap",
			"resource.workspace",
			"resource.network-port",
		],
	},
	{
		id: "authenticated-web",
		engineId: "passive-runtime",
		variants: [
			{
				id: "configured-auth-readonly",
				stepIds: ["auth:session", "dast:authenticated-readonly-standard"],
				qualificationFixture: fixture("authenticated-web"),
			},
		],
		dependencyIds: ["docker.daemon", "scanner.zap", "resource.workspace"],
	},
	{
		id: "api-readonly",
		engineId: "passive-runtime",
		variants: [
			{
				id: "auto-schema",
				stepIds: ["api:schemathesis-readonly"],
				qualificationFixture: fixture("api-readonly"),
			},
		],
		dependencyIds: [
			"docker.daemon",
			"scanner.schemathesis",
			"resource.workspace",
			"resource.network-port",
		],
	},
	{
		id: "active-technical-lab",
		engineId: "controlled-active",
		variants: [
			{
				id: "transaction",
				stepIds: ["active:transaction"],
				qualificationFixture: fixture("active-technical-lab"),
			},
			{
				id: "authorization-matrix",
				stepIds: ["active:authorization-matrix"],
				qualificationFixture: fixture("active-technical-lab"),
			},
			{
				id: "zap-active",
				stepIds: ["active:zap"],
				qualificationFixture: fixture("active-technical-lab"),
			},
		],
		dependencyIds: ["docker.daemon", "scanner.zap", "resource.workspace"],
	},
	{
		id: "business-logic-lab",
		engineId: "controlled-active",
		variants: [
			{
				id: "configured-scenario",
				stepIds: ["business:scenario"],
				qualificationFixture: fixture("business-logic-lab"),
			},
		],
		dependencyIds: ["docker.daemon", "resource.workspace"],
	},
	{
		id: "remediation-verification",
		engineId: "replay",
		variants: [
			{
				id: "reproduction-replay",
				stepIds: ["reproduction:replay"],
				qualificationFixture: fixture("remediation-verification"),
			},
		],
		dependencyIds: ["resource.workspace"],
	},
];

const parsedManifest = scanDependencyManifestSchema.parse(dependencyManifest);

function buildDefinitions(): readonly ScanProfileDefinition[] {
	return SEEDS.map((seed) => {
		const catalog = getCatalogEntry(seed.id);
		if (!catalog)
			throw new Error(`profile_definition_catalog_missing:${seed.id}`);
		return scanProfileDefinitionSchema.parse({
			...seed,
			availability: catalog.availability,
			safetyClass: catalog.safetyClass,
		});
	});
}

export const SCAN_PROFILE_DEFINITIONS = buildDefinitions();

export function getScanProfileDefinition(
	id: CanonicalProfileId,
): ScanProfileDefinition {
	const definition = SCAN_PROFILE_DEFINITIONS.find((entry) => entry.id === id);
	if (!definition) throw new Error(`profile_definition_missing:${id}`);
	return definition;
}

/** Fails closed when catalog, registry, dependency manifest, or fixtures drift. */
export function assertScanProfileDefinitionIntegrity(): void {
	const catalogIds = new Set(SCAN_PROFILE_CATALOG.map((entry) => entry.id));
	const definitionIds = new Set(
		SCAN_PROFILE_DEFINITIONS.map((entry) => entry.id),
	);
	const canonicalIds = canonicalProfileIdSchema.options;
	if (
		catalogIds.size !== canonicalIds.length ||
		definitionIds.size !== canonicalIds.length
	) {
		throw new Error("profile_definition_count_mismatch");
	}
	for (const id of canonicalIds) {
		if (!catalogIds.has(id)) throw new Error(`profile_catalog_missing:${id}`);
		if (!definitionIds.has(id))
			throw new Error(`profile_definition_missing:${id}`);
	}
	const dependencyIds = new Set(
		parsedManifest.entries.map((entry) => entry.id),
	);
	for (const definition of SCAN_PROFILE_DEFINITIONS) {
		for (const dependencyId of definition.dependencyIds) {
			if (!dependencyIds.has(dependencyId)) {
				throw new Error(
					`profile_dependency_missing:${definition.id}:${dependencyId}`,
				);
			}
		}
		for (const variant of definition.variants) {
			if (variant.stepIds.length === 0) {
				throw new Error(
					`profile_variant_has_no_steps:${definition.id}:${variant.id}`,
				);
			}
			for (const dependencyId of variant.dependencyIds ?? []) {
				if (!dependencyIds.has(dependencyId)) {
					throw new Error(
						`profile_variant_dependency_missing:${definition.id}:${variant.id}:${dependencyId}`,
					);
				}
			}
		}
	}
}

assertScanProfileDefinitionIntegrity();
