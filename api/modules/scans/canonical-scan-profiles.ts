import type {
	ScanProfile,
	ScanScopePolicy,
} from "../../../shared/schemas/scan-profile.schema";
import { isOptionalScannerAdapterEnabled } from "./optional-scanner-adapter-config";

const OPTIONAL_SEMGREP_TOOL = {
	toolId: "semgrep",
	displayName: "Semgrep Static Analysis",
	required: true,
	failurePolicy: "fail_profile" as const,
	options: { config: "curated-sast-v1" },
};

function sourceSastRequirement(enabled: boolean) {
	return enabled
		? [
				{
					capabilityId: "source_sast" as const,
					requirement: "required" as const,
				},
			]
		: [
				{
					capabilityId: "source_sast" as const,
					requirement: "advisory" as const,
				},
			];
}

export function buildCanonicalScanProfiles(params: {
	sourceScope: ScanScopePolicy;
	dependencyScope?: ScanScopePolicy;
	semgrepEnabled?: boolean;
}): ScanProfile[] {
	const semgrepEnabled =
		params.semgrepEnabled ?? isOptionalScannerAdapterEnabled("semgrep");
	const sourceSastTool = semgrepEnabled ? [OPTIONAL_SEMGREP_TOOL] : [];
	return [
		{
			id: "change-gate",
			name: "変更差分セキュリティゲート",
			description:
				"変更範囲のシークレット、依存関係、設定を strict policy で確認します。",
			category: "basic",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 900,
			scope: params.sourceScope,
			supportedTargets: ["commit", "range", "working_tree"],
			tools: [
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
				...sourceSastTool,
			],
			capabilityRequirements: [
				{ capabilityId: "secret_detection", requirement: "required" },
				{ capabilityId: "sca", requirement: "required" },
				{ capabilityId: "iac_config", requirement: "required" },
				...sourceSastRequirement(semgrepEnabled),
			],
			coverageGaps: semgrepEnabled ? [] : ["source_sast_adapter_not_available"],
		},
		{
			id: "source-assurance",
			name: "ソースセキュリティ保証",
			description:
				"リポジトリ全体のシークレット、依存関係、設定を strict policy で確認します。",
			category: "basic",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 900,
			scope: params.sourceScope,
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
					required: true,
					failurePolicy: "fail_profile",
					options: { scanners: ["vuln", "secret", "misconfig"] },
				},
				...sourceSastTool,
			],
			capabilityRequirements: [
				{ capabilityId: "secret_detection", requirement: "required" },
				{ capabilityId: "sca", requirement: "required" },
				{ capabilityId: "iac_config", requirement: "required" },
				...sourceSastRequirement(semgrepEnabled),
			],
			coverageGaps: semgrepEnabled ? [] : ["source_sast_adapter_not_available"],
		},
		{
			id: "dependency-supply-chain",
			name: "依存関係・サプライチェーン保証",
			description:
				"OSVによる依存関係診断、Trivy CycloneDX SBOM生成、Cosignによる署名付きSLSA provenanceのオフライン検証を実行します。",
			category: "focused",
			enabled: true,
			strictness: "strict",
			defaultTimeoutSec: 900,
			scope: params.dependencyScope ?? params.sourceScope,
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
				{
					kind: "sbom_export",
					adapter: "trivy",
					displayName: "Trivy CycloneDX SBOM",
					required: true,
					failurePolicy: "fail_profile",
					target: { mode: "project_filesystem" },
					format: "cyclonedx",
				},
				{
					kind: "attestation_verify",
					adapter: "cosign",
					displayName: "Cosign Offline Attestation Verification",
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
		},
	];
}
