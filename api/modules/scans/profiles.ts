import type { ScanProfile } from "../../../shared/schemas/scan-profile.schema";

export const SCAN_PROFILES: ScanProfile[] = [
	{
		id: "baseline",
		name: "Baseline Scan",
		description:
			"Standard check including Semgrep, Gitleaks, OSV-Scanner, and Trivy.",
		enabled: true,
		defaultTimeoutSec: 600,
		tools: [
			{
				toolId: "semgrep",
				displayName: "Semgrep Static Analysis",
				required: true,
				failurePolicy: "fail_profile",
				options: { config: "auto" },
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
			},
			{
				toolId: "trivy",
				displayName: "Trivy Vulnerability & Security Scanner",
				required: true,
				failurePolicy: "fail_profile",
			},
		],
	},
	{
		id: "secrets",
		name: "Secret Detection Profile",
		description:
			"Dedicated scan focused on secrets and credentials leak detection.",
		enabled: true,
		defaultTimeoutSec: 300,
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
			},
		],
	},
	{
		id: "dependencies",
		name: "Dependency Vulnerability Profile",
		description:
			"Focused scan on package manifest and lockfile vulnerabilities.",
		enabled: true,
		defaultTimeoutSec: 300,
		tools: [
			{
				toolId: "osv",
				displayName: "OSV Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
			},
			{
				toolId: "trivy",
				displayName: "Trivy Dependency Scanner",
				required: true,
				failurePolicy: "fail_profile",
			},
		],
	},
	{
		id: "iac",
		name: "Infrastructure as Code Profile",
		description:
			"Focused scan on configuration files, IaC, and deployment manifests.",
		enabled: true,
		defaultTimeoutSec: 300,
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
				displayName: "Trivy Config Scanner",
				required: true,
				failurePolicy: "fail_profile",
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
