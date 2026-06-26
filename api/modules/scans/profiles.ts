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
		name: "Baseline Scan",
		description:
			"Standard source-focused check including Semgrep, Gitleaks, OSV-Scanner, and Trivy.",
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
			{
				toolId: "trivy",
				displayName: "Trivy Secret Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["secret"] },
			},
		],
	},
	{
		id: "basic-security",
		name: "基本セキュリティスキャン",
		description:
			"1回の実行で静的解析、シークレット、依存関係、設定ミスの基本観点を確認する標準プリセット。",
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
				displayName: "OSV Manifest Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { dependencyMode: "manifest" },
			},
			{
				toolId: "trivy",
				displayName: "Trivy Basic Filesystem Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["vuln", "secret", "misconfig"] },
			},
		],
	},
	{
		id: "source-baseline",
		name: "Source Baseline Scan",
		description:
			"Source-first scan that excludes generated output and installed dependencies.",
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
			{
				toolId: "trivy",
				displayName: "Trivy Source Secret Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["secret"] },
			},
		],
	},
	{
		id: "secrets",
		name: "Secret Detection Profile",
		description:
			"Dedicated scan focused on secrets and credentials leak detection.",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 300,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [
			{
				toolId: "gitleaks",
				displayName: "Gitleaks Secret Detection",
				required: true,
				failurePolicy: "fail_profile",
			},
			{
				toolId: "trivy",
				displayName: "Trivy Secret Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["secret"] },
			},
		],
	},
	{
		id: "dependencies",
		name: "Dependency Vulnerability Profile",
		description:
			"Focused scan on package manifest and lockfile vulnerabilities.",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 300,
		scope: DEPENDENCY_MANIFEST_SCOPE,
		tools: [
			{
				toolId: "osv",
				displayName: "OSV Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { dependencyMode: "manifest" },
			},
			{
				toolId: "trivy",
				displayName: "Trivy Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["vuln"] },
			},
		],
	},
	{
		id: "dependency-manifest",
		name: "Dependency Manifest Scan",
		description:
			"Dependency vulnerability scan focused on manifests and lockfiles, excluding installed package trees.",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 300,
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
				displayName: "Trivy Manifest Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["vuln"] },
			},
		],
	},
	{
		id: "iac",
		name: "Infrastructure as Code Profile",
		description:
			"Focused scan on configuration files, IaC, and deployment manifests.",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 300,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep IaC Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "p/security" },
			},
			{
				toolId: "trivy",
				displayName: "Trivy Misconfiguration Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["misconfig"] },
			},
		],
	},
	{
		id: "artifact",
		name: "Artifact Scan",
		description:
			"Release artifact scan for dist, dist-web, build output, bundles, and source maps.",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 600,
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
				displayName: "Trivy Artifact Scanner",
				required: true,
				failurePolicy: "fail_profile",
				options: { scanners: ["secret"] },
			},
			{
				toolId: "semgrep",
				displayName: "Semgrep Generated Code Scanner",
				required: false,
				failurePolicy: "warn_and_continue",
				options: { config: "auto" },
			},
		],
	},
	{
		id: "full-deep",
		name: "Full Deep Scan",
		description:
			"Broad audit scan including generated output, vendored code, and installed dependency trees.",
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
				options: { config: "auto" },
			},
			{
				toolId: "gitleaks",
				displayName: "Gitleaks Deep Secret Detection",
				required: true,
				failurePolicy: "fail_profile",
			},
			{
				toolId: "osv",
				displayName: "OSV Deep Dependency Scanner",
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
		name: "詳細セキュリティスキャン",
		description:
			"生成物、vendored code、installed dependency tree まで含め、基本プリセットより広い範囲と多い観点で確認する詳細プリセット。",
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
