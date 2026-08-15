import type { findings } from "../../db/schema";
import { semgrepReproductionProfile } from "../../plugins/scanners/semgrep-reproduction-profile";
import { normalizeGitleaks } from "../scans/normalizers/gitleaks";
import { normalizeOsv } from "../scans/normalizers/osv";
import { normalizeTrivy } from "../scans/normalizers/trivy";
import { isOptionalScannerAdapterEnabled } from "../scans/optional-scanner-adapter-config";

export interface ReproductionCommand {
	binaryName: string;
	args: string[];
	rawOutputFileName: string;
	outputFormat: "json";
}

export interface ApplicabilityResult {
	applicable: boolean;
	reason?: string;
}

export interface ReproductionOutcomeResult {
	outcome: "reproduced" | "not_reproduced" | "inconclusive" | "error";
	metadata?: Record<string, unknown>;
}

export interface ReproductionProfile {
	id: string;
	displayName: string;
	description: string;
	sourceTools: string[];
	defaultTimeoutSec: number;
	defaultNetworkMode: "none" | "default";
	prepareExecution?(): Promise<void> | void;
	buildCommand(input: {
		repoPath: string;
		outputPath: string;
		finding: typeof findings.$inferSelect;
	}): ReproductionCommand;
	isApplicable(input: {
		finding: typeof findings.$inferSelect;
	}): ApplicabilityResult;
	evaluate(input: {
		finding: typeof findings.$inferSelect;
		stdout: string;
		stderr: string;
		exitCode: number | null;
		rawOutput: unknown;
	}): ReproductionOutcomeResult;
}

const CORE_REPRODUCTION_PROFILES: ReproductionProfile[] = [
	{
		id: "gitleaks-recheck",
		displayName: "Gitleaks Recheck",
		description:
			"Re-scan the repository using Gitleaks to verify secret presence.",
		sourceTools: ["gitleaks"],
		defaultTimeoutSec: 120,
		defaultNetworkMode: "none",
		isApplicable({ finding }) {
			if (finding.sourceTool !== "gitleaks") {
				return { applicable: false, reason: "Not a Gitleaks finding." };
			}
			return { applicable: true };
		},
		buildCommand({ repoPath, outputPath }) {
			return {
				binaryName: "gitleaks",
				args: [
					"detect",
					"--source",
					repoPath,
					"--report-format",
					"json",
					"--report-path",
					outputPath,
					"--redact",
				],
				rawOutputFileName: "gitleaks-output.json",
				outputFormat: "json",
			};
		},
		evaluate({ finding, stderr, rawOutput }) {
			try {
				const normalized = normalizeGitleaks(rawOutput, { stderr });
				const origRuleId = finding.ruleId;
				const loc = finding.primaryLocation as Record<string, unknown> | null;
				const origPath = loc?.path as string | undefined;

				let matched = false;
				let matchStrength: "exact" | "rule_only" | "none" = "none";

				for (const f of normalized) {
					if (f.ruleId === origRuleId) {
						if (origPath) {
							if (f.primaryLocation.path === origPath) {
								matched = true;
								matchStrength = "exact";
								break;
							}
						} else {
							matched = true;
							matchStrength = "rule_only";
							break;
						}
					}
				}

				if (matched) {
					return {
						outcome: "reproduced",
						metadata: { matchStrength },
					};
				}
				return {
					outcome: "not_reproduced",
					metadata: { matchStrength: "none" },
				};
			} catch (err) {
				return {
					outcome: "inconclusive",
					metadata: {
						error: `Normalization failed: ${(err as Error).message}`,
					},
				};
			}
		},
	},
	{
		id: "osv-dependency-recheck",
		displayName: "OSV Dependency Recheck",
		description:
			"Re-scan package manifests using OSV-Scanner to verify dependency vulnerabilities.",
		sourceTools: ["osv"],
		defaultTimeoutSec: 120,
		defaultNetworkMode: "none",
		isApplicable({ finding }) {
			if (finding.sourceTool !== "osv") {
				return { applicable: false, reason: "Not an OSV finding." };
			}
			const metadata = finding.metadata ?? {};
			const hasPackage =
				typeof metadata.packageName === "string" &&
				metadata.packageName.length > 0;
			const hasAdvisory =
				(typeof metadata.advisoryId === "string" &&
					metadata.advisoryId.length > 0) ||
				(typeof finding.ruleId === "string" && finding.ruleId.length > 0);
			if (!hasPackage && !hasAdvisory) {
				return {
					applicable: false,
					reason: "OSV finding is missing packageName or advisoryId.",
				};
			}
			return { applicable: true };
		},
		buildCommand({ repoPath, outputPath }) {
			return {
				binaryName: "osv-scanner",
				args: [
					"--format",
					"json",
					"--output",
					outputPath,
					"--recursive",
					repoPath,
				],
				rawOutputFileName: "osv-output.json",
				outputFormat: "json",
			};
		},
		evaluate({ finding, stderr, rawOutput }) {
			try {
				const normalized = normalizeOsv(rawOutput, { stderr });
				const origRuleId = finding.ruleId;
				const origPkg = finding.metadata.packageName as string | undefined;

				let matched = false;
				let matchStrength: "exact" | "rule_only" | "none" = "none";

				for (const f of normalized) {
					if (f.ruleId === origRuleId) {
						const newPkg = f.metadata?.packageName;
						if (origPkg) {
							if (newPkg === origPkg) {
								matched = true;
								matchStrength = "exact";
								break;
							}
						} else {
							matched = true;
							matchStrength = "rule_only";
							break;
						}
					}
				}

				if (matched) {
					return {
						outcome: "reproduced",
						metadata: { matchStrength },
					};
				}
				return {
					outcome: "not_reproduced",
					metadata: { matchStrength: "none" },
				};
			} catch (err) {
				return {
					outcome: "inconclusive",
					metadata: {
						error: `Normalization failed: ${(err as Error).message}`,
					},
				};
			}
		},
	},
	{
		id: "trivy-fs-recheck",
		displayName: "Trivy FS Recheck",
		description: "Re-scan the repository filesystem using Trivy.",
		sourceTools: ["trivy"],
		defaultTimeoutSec: 180,
		defaultNetworkMode: "none",
		isApplicable({ finding }) {
			if (finding.sourceTool !== "trivy") {
				return { applicable: false, reason: "Not a Trivy finding." };
			}
			return { applicable: true };
		},
		buildCommand({ repoPath, outputPath }) {
			return {
				binaryName: "trivy",
				args: ["fs", "--format", "json", "--output", outputPath, repoPath],
				rawOutputFileName: "trivy-output.json",
				outputFormat: "json",
			};
		},
		evaluate({ finding, stderr, rawOutput }) {
			try {
				const normalized = normalizeTrivy(rawOutput, { stderr });
				const origRuleId = finding.ruleId;
				const origPkg = finding.metadata.packageName as string | undefined;
				const loc = finding.primaryLocation as Record<string, unknown> | null;
				const origPath = loc?.path as string | undefined;

				let matched = false;
				let matchStrength: "exact" | "rule_only" | "none" = "none";

				for (const f of normalized) {
					if (f.ruleId === origRuleId) {
						if (origPkg) {
							const newPkg = f.metadata?.packageName;
							if (newPkg === origPkg) {
								matched = true;
								matchStrength = "exact";
								break;
							}
						} else {
							const newPath = f.primaryLocation?.path;
							if (newPath === origPath) {
								matched = true;
								matchStrength = "exact";
								break;
							}
						}
						// If rule matches but package name or path doesn't, we still count as matched but rule_only
						matched = true;
						matchStrength = "rule_only";
					}
				}

				if (matched) {
					return {
						outcome: "reproduced",
						metadata: { matchStrength },
					};
				}
				return {
					outcome: "not_reproduced",
					metadata: { matchStrength: "none" },
				};
			} catch (err) {
				return {
					outcome: "inconclusive",
					metadata: {
						error: `Normalization failed: ${(err as Error).message}`,
					},
				};
			}
		},
	},
];

export function createReproductionProfiles(params?: {
	includeOptionalSemgrep?: boolean;
}): ReproductionProfile[] {
	const includeOptionalSemgrep =
		params?.includeOptionalSemgrep ??
		isOptionalScannerAdapterEnabled("semgrep");
	return [
		...(includeOptionalSemgrep ? [semgrepReproductionProfile] : []),
		...CORE_REPRODUCTION_PROFILES,
	];
}

export const REPRODUCTION_PROFILES = createReproductionProfiles();

export function getReproductionProfileById(
	id: string,
	profiles: readonly ReproductionProfile[] = REPRODUCTION_PROFILES,
): ReproductionProfile | undefined {
	return profiles.find((profile) => profile.id === id);
}

export function listReproductionProfiles(
	profiles: readonly ReproductionProfile[] = REPRODUCTION_PROFILES,
): ReproductionProfile[] {
	return [...profiles];
}
