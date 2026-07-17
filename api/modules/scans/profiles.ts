import type {
	DastProfileStep,
	ScanProfile,
	ScanProfileStep,
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

function staticSteps(profile: Pick<ScanProfile, "tools">): ScanProfileStep[] {
	return profile.tools.map((tool) => ({ kind: "static_tool", ...tool }));
}

const AUTO_HTTP_DAST_STEP: DastProfileStep = {
	kind: "dast",
	profileId: "http-baseline",
	displayName: "自動起動HTTP DAST診断",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	options: { maxRequests: 20 },
};

const REQUIRED_AUTO_HTTP_DAST_STEP: DastProfileStep = {
	...AUTO_HTTP_DAST_STEP,
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
};
const ZAP_BASELINE_STEP: ScanProfileStep = {
	kind: "runtime_scanner",
	adapter: "zap-baseline",
	displayName: "ZAP Baseline Passive Scan",
	required: false,
	failurePolicy: "warn_and_continue",
	target: { mode: "auto_project_start" },
	options: {
		maxRequests: 20,
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
};

export const SCAN_PROFILES: ScanProfile[] = [
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
	{
		id: "web-app-baseline",
		name: "Webアプリ標準診断",
		description:
			"Semgrep、Gitleaks、OSV による静的診断と、自動起動したローカル対象への HTTP DAST 診断をまとめて実行します。",
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
		],
		steps: [
			{
				kind: "static_tool",
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "auto", scanners: ["vuln", "secret", "config"] },
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
			AUTO_HTTP_DAST_STEP,
		],
	},
	{
		id: "runtime-web-safe",
		name: "安全なWeb実行時診断",
		description:
			"自動起動したローカル対象に HTTP baseline、Nuclei safe、ZAP baseline を実行します。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 900,
		scope: SOURCE_BASELINE_SCOPE,
		tools: [],
		steps: [AUTO_HTTP_DAST_STEP, NUCLEI_SAFE_STEP, ZAP_BASELINE_STEP],
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
			"選択したプロジェクトを自動起動し、HTTP応答、セキュリティヘッダー、Cookie、CORS を範囲限定の DAST で確認します。",
		category: "focused",
		enabled: true,
		defaultTimeoutSec: 180,
		tools: [],
		steps: [REQUIRED_AUTO_HTTP_DAST_STEP],
	},
	{
		id: "full-security-scan",
		name: "総合セキュリティ診断",
		description:
			"詳細な静的診断と自動起動 HTTP DAST 診断を合わせて、Webアプリの広めの診断証跡を収集します。",
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
		steps: [
			{
				kind: "static_tool",
				toolId: "semgrep",
				displayName: "Semgrep Deep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "auto", maxTargetBytes: 2000000 },
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
			AUTO_HTTP_DAST_STEP,
			NUCLEI_SAFE_STEP,
			ZAP_BASELINE_STEP,
			SCHEMATHESIS_STEP,
		],
	},
	{
		id: "secrets-dependencies-runtime",
		name: "漏えい・依存関係・公開面診断",
		description:
			"Gitleaks、OSV、Trivy と自動起動 HTTP DAST 診断で、シークレット漏えい、依存関係、公開面の証跡を確認します。",
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
			AUTO_HTTP_DAST_STEP,
		],
	},
];

export function getProfileById(id: string): ScanProfile | undefined {
	const profile = SCAN_PROFILES.find((p) => p.id === id && p.enabled);
	return profile
		? { ...profile, steps: profile.steps ?? staticSteps(profile) }
		: undefined;
}
export function listProfiles(): ScanProfile[] {
	return SCAN_PROFILES.filter((p) => p.enabled).map((profile) => ({
		...profile,
		steps: profile.steps ?? staticSteps(profile),
	}));
}
