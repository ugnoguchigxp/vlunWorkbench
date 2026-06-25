import path from "node:path";
import type { findings } from "../../db/schema";
import { normalizeGitleaks } from "../scans/normalizers/gitleaks";
import { normalizeOsv } from "../scans/normalizers/osv";
import { normalizeSemgrep } from "../scans/normalizers/semgrep";
import { normalizeTrivy } from "../scans/normalizers/trivy";

export interface ReproductionCommand {
	binaryName: "semgrep" | "gitleaks" | "osv-scanner" | "trivy";
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

export const REPRODUCTION_PROFILES: ReproductionProfile[] = [
	{
		id: "semgrep-path-recheck",
		displayName: "Semgrep Path Recheck",
		description:
			"Re-scan the specific finding file path using Semgrep in the Docker sandbox.",
		sourceTools: ["semgrep"],
		defaultTimeoutSec: 120,
		defaultNetworkMode: "none",
		isApplicable({ finding }) {
			if (finding.sourceTool !== "semgrep") {
				return { applicable: false, reason: "Not a Semgrep finding." };
			}
			const loc = finding.primaryLocation as Record<string, unknown> | null;
			const filepath = loc?.path as string | undefined;
			if (!filepath || typeof filepath !== "string" || filepath.trim() === "") {
				return {
					applicable: false,
					reason: "Finding is missing a primary location path.",
				};
			}
			const normalized = path.normalize(filepath);
			if (path.isAbsolute(normalized) || normalized.startsWith("..")) {
				return {
					applicable: false,
					reason: "Primary location path is not a safe relative path.",
				};
			}
			return { applicable: true };
		},
		buildCommand({ repoPath, outputPath, finding }) {
			const loc = finding.primaryLocation as Record<string, unknown> | null;
			const filepath = loc?.path as string;
			const normalized = path.normalize(filepath);
			return {
				binaryName: "semgrep",
				args: [
					"scan",
					"--config",
					"auto",
					"--json",
					"--output",
					outputPath,
					"--include",
					normalized,
					repoPath,
				],
				rawOutputFileName: "semgrep-output.json",
				outputFormat: "json",
			};
		},
		evaluate({ finding, stderr, rawOutput }) {
			try {
				const normalized = normalizeSemgrep(rawOutput, { stderr });
				const origRuleId = finding.ruleId;
				const loc = finding.primaryLocation as Record<string, unknown> | null;
				const origPath = loc?.path as string | undefined;
				const origStartLine = loc?.startLine as number | undefined;

				let matched = false;
				let matchStrength: "exact" | "path_rule" | "none" = "none";

				for (const f of normalized) {
					if (f.ruleId === origRuleId && f.primaryLocation.path === origPath) {
						matched = true;
						if (f.primaryLocation.startLine === origStartLine) {
							matchStrength = "exact";
							break;
						}
						matchStrength = "path_rule";
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

export function getReproductionProfileById(
	id: string,
): ReproductionProfile | undefined {
	return REPRODUCTION_PROFILES.find((p) => p.id === id);
}

export function listReproductionProfiles(): ReproductionProfile[] {
	return REPRODUCTION_PROFILES;
}
