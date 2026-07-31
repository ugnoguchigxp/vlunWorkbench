import type {
	DastProfileStep,
	ScanProfile,
	ScanProfileStep,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";
import {
	applyDastStandardRollout,
	assertRuntimeAssessmentBudget,
} from "./dast-profile-rollout";

export {
	plannedRuntimeAssessmentRequests,
	RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET,
} from "./dast-profile-rollout";
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

export const DEPENDENCY_MANIFEST_SCOPE: ScanScopePolicy = {
	intent: "dependency_manifest",
	includeGlobs: [
		"package.json",
		"bun.lock",
		"bun.lockb",
		"package-lock.json",
		"npm-shrinkwrap.json",
		"yarn.lock",
		"pnpm-lock.yaml",
		"**/package.json",
		"**/package-lock.json",
		"**/yarn.lock",
		"**/pnpm-lock.yaml",
	],
	excludeGlobs: ["node_modules/**", "dist/**", "dist-web/**", "build/**"],
	includeGenerated: false,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
	notes:
		"Focuses dependency scanners on manifests and lockfiles instead of deep scanning installed package trees.",
};

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

export const SCAN_PROFILES: ScanProfile[] = [
	...buildStaticScanProfiles({
		SOURCE_BASELINE_SCOPE,
		DEPENDENCY_MANIFEST_SCOPE,
		ARTIFACT_SCOPE,
		FULL_DEEP_SCOPE,
	}),
	{
		id: "web-app-baseline",
		name: "Webアプリ標準診断",
		description:
			"Semgrep、Gitleaks、OSVによる静的診断と、自動起動したローカル対象へのbounded passive DASTをまとめて実行します。",
		category: "basic",
		enabled: true,
		defaultTimeoutSec: 900,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: {
					config: "curated-sast-v1",
					scanners: ["vuln", "secret", "config"],
				},
			},
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
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: {
					config: "curated-sast-v1",
					scanners: ["vuln", "secret", "config"],
				},
			},
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
		defaultTimeoutSec: 900,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [],
		steps: [AUTO_STANDARD_DAST_STEP, NUCLEI_SAFE_STEP, ZAP_BASELINE_STEP],
	},
	{
		id: "sbom-inventory",
		name: "CycloneDXソフトウェアインベントリ",
		description:
			"対象 filesystem から CycloneDX JSON SBOM を生成します。SBOM component は finding に変換しません。",
		category: "focused",
		enabled: true,
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
		defaultTimeoutSec: 600,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [],
		steps: [SCHEMATHESIS_STEP],
	},
	{
		id: "container-image-security",
		name: "既存コンテナイメージ診断",
		description:
			"明示された既存 image ref または image tar だけを Trivy で診断します。自動 build は行いません。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 600,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [],
		steps: [
			{
				kind: "container_image_scan",
				adapter: "trivy",
				displayName: "Trivy Existing Image Scan",
				required: false,
				failurePolicy: "warn_and_continue",
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
		defaultTimeoutSec: 180,
		tools: [],
		steps: [REQUIRED_AUTO_STANDARD_DAST_STEP],
	},
	{
		id: "full-security-scan",
		name: "総合セキュリティ診断",
		description:
			"詳細な静的診断とbounded passive DASTを合わせて、Webアプリの広めの診断証跡を収集します。active attackは実行しません。",
		category: "detailed",
		enabled: true,
		defaultTimeoutSec: 1200,
		scope: FULL_DEEP_SCOPE,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Deep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "curated-sast-v1", maxTargetBytes: 2000000 },
			},
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
		],
		steps: [
			{
				kind: "static_tool",
				toolId: "semgrep",
				displayName: "Semgrep Deep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "curated-sast-v1", maxTargetBytes: 2000000 },
			},
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
			SBOM_STEP,
			AUTO_STANDARD_DAST_STEP,
			NUCLEI_SAFE_STEP,
			ZAP_BASELINE_STEP,
			SCHEMATHESIS_STEP,
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

export function getProfileById(id: string): ScanProfile | undefined {
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
