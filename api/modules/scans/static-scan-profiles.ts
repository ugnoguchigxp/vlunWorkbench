import type {
	ScanProfile,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";

type StaticProfileScopes = {
	SOURCE_BASELINE_SCOPE: ScanScopePolicy;
	DEPENDENCY_MANIFEST_SCOPE: ScanScopePolicy;
	ARTIFACT_SCOPE: ScanScopePolicy;
	FULL_DEEP_SCOPE: ScanScopePolicy;
};

export function buildStaticScanProfiles(
	scopes: StaticProfileScopes,
): ScanProfile[] {
	const {
		SOURCE_BASELINE_SCOPE,
		DEPENDENCY_MANIFEST_SCOPE,
		ARTIFACT_SCOPE,
		FULL_DEEP_SCOPE,
	} = scopes;
	return [
		{
			id: "agent-output",
			name: "Agent Output Security Oracle",
			description:
				"External orchestration agents can run this source-focused static profile through the stable security oracle CLI contract.",
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
					displayName: "OSV Manifest Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
			],
		},
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
					displayName: "OSV Manifest Dependency Scanner",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
			],
		},
		{
			id: "diff-source-baseline",
			name: "Git差分ソーススキャン",
			description:
				"commit、branch range、working treeで変更されたファイルをSemgrep、Gitleaks、OSV、Trivyで確認します。",
			category: "focused",
			enabled: true,
			defaultTimeoutSec: 600,
			scope: SOURCE_BASELINE_SCOPE,
			supportedTargets: ["commit", "range", "working_tree"],
			tools: [
				{
					toolId: "semgrep",
					displayName: "Semgrep Changed Source Analysis",
					required: true,
					failurePolicy: "fail_profile",
					options: { config: "curated-sast-v1" },
				},
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Changed File Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV Changed Dependency State",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { dependencyMode: "manifest" },
				},
				{
					toolId: "trivy",
					displayName: "Trivy Changed Filesystem Scan",
					required: false,
					failurePolicy: "warn_and_continue",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
			],
		},
		{
			id: "diff-basic-security",
			name: "Git差分基本セキュリティスキャン",
			description:
				"commit、branch range、working tree の変更範囲を Semgrep、Gitleaks、OSV、Trivy の必須検査で確認します。",
			category: "basic",
			enabled: true,
			defaultTimeoutSec: 900,
			scope: SOURCE_BASELINE_SCOPE,
			supportedTargets: ["commit", "range", "working_tree"],
			tools: [
				{
					toolId: "semgrep",
					displayName: "Semgrep Changed Source Analysis",
					required: true,
					failurePolicy: "fail_profile",
					options: {
						config: "curated-sast-v1",
						scanners: ["vuln", "secret", "config"],
					},
				},
				{
					toolId: "gitleaks",
					displayName: "Gitleaks Changed File Detection",
					required: true,
					failurePolicy: "fail_profile",
				},
				{
					toolId: "osv",
					displayName: "OSV Changed Dependency State",
					required: true,
					failurePolicy: "fail_profile",
					options: { dependencyMode: "manifest" },
				},
				{
					toolId: "trivy",
					displayName: "Trivy Changed Filesystem Scan",
					required: true,
					failurePolicy: "fail_profile",
					options: { scanners: ["vuln", "secret", "misconfig"] },
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
		},
	];
}
