import type {
	ScanProfile,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";

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

export const SCAN_PROFILES: ScanProfile[] = [
	{
		id: "baseline",
		name: "標準スキャン",
		description:
			"Semgrep、Gitleaks、OSV-Scanner で、コード実装、シークレット、依存関係の基本観点を確認します。",
		category: "basic",
		enabled: true,
		defaultTimeoutSec: 600,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "auto", scanners: ["vuln", "secret", "config"] },
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
	},
	{
		id: "source-baseline",
		name: "ソースコード重点スキャン",
		description:
			"生成物や installed dependency tree を外し、手元のソースコードを中心に Semgrep、Gitleaks、OSV で確認します。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 600,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Source Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "auto", scanners: ["vuln", "secret", "config"] },
			},
			{
				toolId: "gitleaks",
				displayName: "Gitleaks Secret Detection",
				required: true,
				failurePolicy: "fail_profile",
			},
			{
				toolId: "osv",
				displayName: "OSV Manifest Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { dependencyMode: "manifest" },
			},
		],
	},
	{
		id: "basic-security",
		name: "基本セキュリティスキャン",
		description:
			"コード実装、シークレット、依存関係、設定ミスの基本観点を Semgrep、Gitleaks、OSV、Trivy で確認します。",
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
				options: { config: "auto", scanners: ["vuln", "secret", "config"] },
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
			{
				toolId: "trivy",
				displayName: "Trivy Filesystem Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["vuln", "secret", "misconfig"] },
			},
		],
	},
	{
		id: "dependency-manifest",
		name: "依存マニフェストスキャン",
		description:
			"manifest と lockfile に範囲を絞り、既知脆弱性のある依存パッケージを確認します。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 600,
		scope: DEPENDENCY_MANIFEST_SCOPE,
		tools: [
			{
				toolId: "osv",
				displayName: "OSV Manifest Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { dependencyMode: "manifest" },
			},
			{
				toolId: "trivy",
				displayName: "Trivy Manifest Scanner",
				required: false,
				failurePolicy: "warn_and_continue",
				options: { scanners: ["vuln"] },
			},
		],
	},
	{
		id: "artifact",
		name: "ビルド成果物スキャン",
		description:
			"dist、build、source map など、リリース成果物に残るシークレットや問題を確認します。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 900,
		scope: ARTIFACT_SCOPE,
		tools: [
			{
				toolId: "gitleaks",
				displayName: "Gitleaks Artifact Secret Detection",
				required: true,
				failurePolicy: "fail_profile",
			},
			{
				toolId: "trivy",
				displayName: "Trivy Artifact Filesystem Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["vuln", "secret", "misconfig"] },
			},
		],
	},
	{
		id: "full-deep",
		name: "全体深掘りスキャン",
		description:
			"生成物、vendored code、installed dependencies まで広げて、Static 検査を深く実行します。",
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
				options: { config: "auto", maxTargetBytes: 2000000 },
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
	},
	{
		id: "detailed-security",
		name: "詳細スキャン",
		description:
			"Semgrep、Gitleaks、OSV-Scanner、Trivy で、生成物や installed dependency tree まで含めて Static 全検査を実行します。",
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
				options: { config: "auto", maxTargetBytes: 2000000 },
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
	},
];

export function getProfileById(id: string): ScanProfile | undefined {
	return SCAN_PROFILES.find((p) => p.id === id && p.enabled);
}
export function listProfiles(): ScanProfile[] {
	return SCAN_PROFILES.filter((p) => p.enabled);
}
