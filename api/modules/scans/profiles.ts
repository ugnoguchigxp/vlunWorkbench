import type {
	DastProfileStep,
	ScanProfile,
	ScanProfileStep,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";
import { buildOptionalSemgrepProfile } from "../../plugins/scanners/semgrep-profile";
import {
	applyDastStandardRollout,
	assertRuntimeAssessmentBudget,
} from "./dast-profile-rollout";
import {
	type OptionalScannerSelection,
	optionalScannerSelection,
} from "./optional-scanner-adapter-config";
import { buildPluginDependencyManifestScope } from "./plugin-dependency-scope";

export {
	plannedRuntimeAssessmentRequests,
	RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET,
} from "./dast-profile-rollout";

import { buildCanonicalScanProfiles } from "./canonical-scan-profiles";
import { buildStaticScanProfiles } from "./static-scan-profiles";
import { ZAP_ACTIVE_DEDICATED_PROFILES } from "./zap-active-profiles";

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

function staticSteps(profile: Pick<ScanProfile, "tools">): ScanProfileStep[] {
	return profile.tools.map((tool) => ({ kind: "static_tool", ...tool }));
}

const AUTO_STANDARD_DAST_STEP: DastProfileStep = {
	kind: "dast",
	profileId: "web-passive-standard",
	displayName: "自動起動Web Passive Standard DAST",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	options: {
		maxRequests: 100,
		maxDepth: 2,
		aggregateRequestBudget: 100,
		maxDiscoveredUrls: 500,
		maxResponseBytes: 1024 * 1024,
		includeApplicationModelSeeds: true,
		includeOpenApiSeeds: true,
	},
};

const REQUIRED_AUTO_STANDARD_DAST_STEP: DastProfileStep = {
	...AUTO_STANDARD_DAST_STEP,
	required: true,
	failurePolicy: "fail_profile",
};

const NUCLEI_SAFE_STEP: ScanProfileStep = {
	kind: "runtime_scanner",
	adapter: "nuclei-safe",
	displayName: "Nuclei Safe Web Scan",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	options: {
		maxRequests: 20,
		rateLimitPerSec: 2,
	},
};
const REQUIRED_NUCLEI_SAFE_STEP: ScanProfileStep = {
	...NUCLEI_SAFE_STEP,
	required: true,
	failurePolicy: "fail_profile",
};
const ZAP_BASELINE_STEP: ScanProfileStep = {
	kind: "runtime_scanner",
	adapter: "zap-baseline",
	displayName: "ZAP Baseline Passive Scan",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	options: {
		maxRequests: 100,
		rateLimitPerSec: 2,
		spiderMinutes: 1,
		passiveWaitMinutes: 3,
	},
};
const REQUIRED_ZAP_BASELINE_STEP: ScanProfileStep = {
	...ZAP_BASELINE_STEP,
	required: true,
	failurePolicy: "fail_profile",
};
const SBOM_STEP: ScanProfileStep = {
	kind: "sbom_export",
	adapter: "trivy",
	displayName: "Trivy CycloneDX SBOM",
	required: true,
	failurePolicy: "fail_profile",
	target: { mode: "project_filesystem" },
	format: "cyclonedx",
};
const SCHEMATHESIS_STEP: ScanProfileStep = {
	kind: "api_schema_scan",
	adapter: "schemathesis",
	displayName: "Schemathesis Read-only API Scan",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	schema: { mode: "auto_discover", kind: "auto" },
	options: {
		maxRequests: 30,
		rateLimitPerSec: 2,
	},
};
const REQUIRED_SCHEMATHESIS_STEP: ScanProfileStep = {
	...SCHEMATHESIS_STEP,
	required: true,
	failurePolicy: "fail_profile",
};

const OPTIONAL_SEMGREP_TOOL = {
	toolId: "semgrep",
	displayName: "Semgrep Static Analysis (optional engine)",
	required: true,
	failurePolicy: "fail_profile" as const,
	options: { config: "curated-sast-v1" },
};

const REQUIRED_ZIZMOR_TOOL = {
	toolId: "zizmor",
	displayName: "zizmor CI Workflow Security",
	required: true,
	requirement: "required_if_applicable" as const,
	failurePolicy: "fail_profile" as const,
};

const SLSA_SUPPLY_CHAIN_PROFILE: ScanProfile = {
	id: "dependency-supply-chain-slsa",
	name: "依存関係・SLSA provenance保証",
	description:
		"OSV依存関係診断、Trivy CycloneDX SBOM生成、slsa-verifierによる成果物provenanceのsource・builder・ref検証を実行します。",
	category: "focused",
	enabled: true,
	strictness: "strict",
	defaultTimeoutSec: 900,
	scope: DEPENDENCY_MANIFEST_SCOPE,
	supportedTargets: ["full"],
	tools: [
		{
			toolId: "osv",
			displayName: "OSV Dependency Scanner",
			required: true,
			failurePolicy: "fail_profile",
			options: { dependencyMode: "manifest" },
		},
	],
	steps: [
		{
			kind: "static_tool",
			toolId: "osv",
			displayName: "OSV Dependency Scanner",
			required: true,
			failurePolicy: "fail_profile",
			options: { dependencyMode: "manifest" },
		},
		SBOM_STEP,
		{
			kind: "attestation_verify",
			adapter: "slsa-verifier",
			displayName: "SLSA Provenance Policy Verification",
			required: true,
			failurePolicy: "fail_profile",
			target: { mode: "repository_relative_files" },
		},
	],
	capabilityRequirements: [
		{ capabilityId: "sca", requirement: "required" },
		{ capabilityId: "sbom", requirement: "required" },
		{ capabilityId: "provenance_integrity", requirement: "required" },
	],
	coverageGaps: [],
};

export function buildScanProfiles(params?: {
	optionalAdapterIds?: readonly string[];
}): ScanProfile[] {
	const semgrepSelection: OptionalScannerSelection = params?.optionalAdapterIds
		? optionalScannerSelection("semgrep", {
				preferredIds: params.optionalAdapterIds,
				requiredIds: [],
			})
		: optionalScannerSelection("semgrep");
	const semgrepProfileEnabled = semgrepSelection !== "disabled";
	const fullSecuritySemgrepTools = semgrepProfileEnabled
		? [
				{
					...OPTIONAL_SEMGREP_TOOL,
					required: semgrepSelection === "required",
					requirement:
						semgrepSelection === "required"
							? ("required_if_applicable" as const)
							: ("advisory" as const),
					failurePolicy:
						semgrepSelection === "required"
							? ("fail_profile" as const)
							: ("warn_and_continue" as const),
				},
			]
		: [];
	return [
		...buildStaticScanProfiles({
			SOURCE_BASELINE_SCOPE,
			DEPENDENCY_MANIFEST_SCOPE,
			ARTIFACT_SCOPE,
			FULL_DEEP_SCOPE,
		}),
		...(semgrepProfileEnabled
			? [buildOptionalSemgrepProfile(SOURCE_BASELINE_SCOPE)]
			: []),
		{
			id: "web-app-baseline",
			name: "Webアプリ標準診断",
			description:
				"Gitleaks、OSVによる静的診断と、自動起動したローカル対象へのbounded passive DASTをまとめて実行します。",
			category: "basic",
			enabled: true,
			defaultTimeoutSec: 900,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
			],
			steps: [
				{
					kind: "static_tool",
					toolId: "gitleaks",
					displayName: "Gitleaks Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					kind: "static_tool",
					toolId: "osv",
					displayName: "OSV Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
				AUTO_STANDARD_DAST_STEP,
			],
		},
		{
			id: "runtime-web-safe",
			name: "安全なWeb実行時診断",
			description:
				"自動起動したローカル対象にbounded passive DAST、Nuclei safe、ZAP baselineを実行します。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 900,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [],
			steps: [
				REQUIRED_AUTO_STANDARD_DAST_STEP,
				REQUIRED_NUCLEI_SAFE_STEP,
				REQUIRED_ZAP_BASELINE_STEP,
			],
		},
		{
			id: "sbom-inventory",
			name: "CycloneDXソフトウェアインベントリ",
			description:
				"対象 filesystem から CycloneDX JSON SBOM を生成します。SBOM component は finding に変換しません。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 600,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [],
			steps: [SBOM_STEP],
		},
		{
			id: "api-schema-readonly",
			name: "APIスキーマ読み取り専用診断",
			description:
				"自動起動したローカル対象の OpenAPI/GraphQL を検出し、読み取り専用 operation に限定して確認します。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 600,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [],
			steps: [REQUIRED_SCHEMATHESIS_STEP],
		},
		{
			id: "container-image-security",
			name: "既存コンテナイメージ診断",
			description:
				"明示された既存 image ref または image tar だけを Trivy で診断します。自動 build は行いません。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 600,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [],
			steps: [
				{
					kind: "container_image_scan",
					adapter: "trivy",
					displayName: "Trivy Existing Image Scan",
					required: true,
					failurePolicy: "fail_profile",
					target: { mode: "explicit_existing_image" },
				},
			],
		},
		{
			id: "runtime-zap-baseline",
			name: "ZAP Baseline Passive Scan",
			description:
				"公式 ZAP image を Docker で実行し、bounded gateway 経由で自動起動したローカル対象を passive scan します。",
			category: "detailed",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 600,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [],
			steps: [REQUIRED_ZAP_BASELINE_STEP],
		},
		{
			id: "runtime-http-check",
			name: "実行時HTTP診断",
			description:
				"選択したプロジェクトを自動起動し、既知route coverageを伴うbounded passive DASTを実行します。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 180,
			tools: [],
			steps: [REQUIRED_AUTO_STANDARD_DAST_STEP],
		},
		{
			id: "full-security-scan",
			name: "総合セキュリティ診断",
			description:
				"詳細な静的診断、GitHub Actions workflow保証、bounded passive DASTを合わせて、Webアプリの広めの診断証跡を収集します。active attackは実行しません。",
			category: "detailed",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 1200,
			scope: FULL_DEEP_SCOPE,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Deep Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV Installed Tree Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "installed_tree" },
				},
				{
					toolId: "trivy",
					displayName: "Trivy Deep Filesystem Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
				REQUIRED_ZIZMOR_TOOL,
				...fullSecuritySemgrepTools,
			],
			steps: [
				{
					kind: "static_tool",
					toolId: "gitleaks",
					displayName: "Gitleaks Deep Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					kind: "static_tool",
					toolId: "osv",
					displayName: "OSV Installed Tree Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "installed_tree" },
				},
				{
					kind: "static_tool",
					toolId: "trivy",
					displayName: "Trivy Deep Filesystem Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
				{ kind: "static_tool" as const, ...REQUIRED_ZIZMOR_TOOL },
				...fullSecuritySemgrepTools.map((tool) => ({
					kind: "static_tool" as const,
					...tool,
				})),
				SBOM_STEP,
				REQUIRED_AUTO_STANDARD_DAST_STEP,
				REQUIRED_NUCLEI_SAFE_STEP,
				REQUIRED_ZAP_BASELINE_STEP,
				REQUIRED_SCHEMATHESIS_STEP,
			],
			capabilityRequirements: [
				{ capabilityId: "secret_detection", requirement: "required" },
				{ capabilityId: "sca", requirement: "required" },
				{ capabilityId: "iac_config", requirement: "required" },
				{
					capabilityId: "cicd_workflow_integrity",
					requirement: "required_if_applicable",
				},
				{ capabilityId: "sbom", requirement: "required" },
				{ capabilityId: "passive_dast", requirement: "required" },
				{
					capabilityId: "source_sast",
					requirement:
						semgrepSelection === "required" ? "required" : "advisory",
				},
				{
					capabilityId: "api_schema_contract",
					requirement: "required_if_applicable",
				},
				{ capabilityId: "provenance_integrity", requirement: "advisory" },
				{ capabilityId: "artifact_container", requirement: "advisory" },
				{ capabilityId: "dynamic_tests", requirement: "advisory" },
				{ capabilityId: "sanitizer_fuzz", requirement: "advisory" },
				{ capabilityId: "browser_client", requirement: "advisory" },
				{ capabilityId: "authentication_session", requirement: "advisory" },
				{ capabilityId: "authorization_matrix", requirement: "advisory" },
				{ capabilityId: "active_dast", requirement: "advisory" },
				{ capabilityId: "business_logic", requirement: "advisory" },
				{ capabilityId: "remediation_retest", requirement: "advisory" },
			],
			coverageGaps: semgrepProfileEnabled
				? []
				: ["source_sast_adapter_not_available"],
		},
		{
			id: "security-inventory-best-effort",
			name: "セキュリティインベントリ（ベストエフォート）",
			description:
				"利用可能な静的スキャナと SBOM を収集します。未準備の scanner は coverage gap として明示します。リリース判定には使用しません。",
			category: "focused",
			enabled: true,
			strictness: "best_effort",
			defaultTimeoutSec: 900,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { dependencyMode: "manifest" },
				},
				{
					toolId: "trivy",
					displayName: "Trivy",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
			],
		},
		{
			id: "secrets-dependencies-runtime",
			name: "漏えい・依存関係・公開面診断",
			description:
				"Gitleaks、OSV、Trivyとbounded passive DASTで、シークレット漏えい、依存関係、公開面の証跡を確認します。",
			category: "focused",
			enabled: true,
			defaultTimeoutSec: 900,
			scope: SOURCE_BASELINE_SCOPE,
			tools: [
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
				{
					toolId: "trivy",
					displayName: "Trivy Filesystem Scanner",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
			],
			steps: [
				{
					kind: "static_tool",
					toolId: "gitleaks",
					displayName: "Gitleaks Secret Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					kind: "static_tool",
					toolId: "osv",
					displayName: "OSV Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
				{
					kind: "static_tool",
					toolId: "trivy",
					displayName: "Trivy Filesystem Scanner",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
				AUTO_STANDARD_DAST_STEP,
			],
		},
		...ZAP_ACTIVE_DEDICATED_PROFILES,
	];
}

export const SCAN_PROFILES: ScanProfile[] = buildScanProfiles();

/** Canonical profiles are intentionally separate from the frozen legacy list. */
export function getCanonicalProfileById(id: string): ScanProfile | undefined {
	const profile = buildCanonicalScanProfiles({
		sourceScope: SOURCE_BASELINE_SCOPE,
		dependencyScope: DEPENDENCY_MANIFEST_SCOPE,
	}).find((candidate) => candidate.id === id && candidate.enabled);
	if (profile) assertRuntimeAssessmentBudget(profile);
	return profile;
}

export function listCanonicalProfiles(): ScanProfile[] {
	return buildCanonicalScanProfiles({
		sourceScope: SOURCE_BASELINE_SCOPE,
		dependencyScope: DEPENDENCY_MANIFEST_SCOPE,
	}).map((profile) => {
		assertRuntimeAssessmentBudget(profile);
		return profile;
	});
}

export function getProfileById(id: string): ScanProfile | undefined {
	if (id === SLSA_SUPPLY_CHAIN_PROFILE.id) return SLSA_SUPPLY_CHAIN_PROFILE;
	const profile = SCAN_PROFILES.find((p) => p.id === id && p.enabled);
	const rolledOut = profile
		? applyDastStandardRollout({
				...profile,
				steps: profile.steps ?? staticSteps(profile),
			})
		: undefined;
	if (rolledOut) assertRuntimeAssessmentBudget(rolledOut);
	return rolledOut;
}
export function listProfiles(): ScanProfile[] {
	return SCAN_PROFILES.filter((p) => p.enabled).map((profile) => {
		const rolledOut = applyDastStandardRollout({
			...profile,
			steps: profile.steps ?? staticSteps(profile),
		});
		assertRuntimeAssessmentBudget(rolledOut);
		return rolledOut;
	});
}
