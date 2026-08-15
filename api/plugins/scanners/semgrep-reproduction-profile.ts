import path from "node:path";
import type { ReproductionProfile } from "../../modules/reproductions/profiles";
import { normalizeSemgrep } from "../../modules/scans/normalizers/semgrep";
import { StaticScannerAdapterRegistry } from "../../modules/scans/static-scanner-adapter-registry";
import { semgrepScannerAdapter } from "./semgrep";

export const semgrepReproductionProfile: ReproductionProfile = {
	id: "semgrep-path-recheck",
	displayName: "Semgrep Path Recheck (optional)",
	description:
		"Re-scan the specific finding file path using the optional Semgrep adapter image.",
	sourceTools: ["semgrep"],
	defaultTimeoutSec: 120,
	defaultNetworkMode: "none",
	prepareExecution() {
		new StaticScannerAdapterRegistry().register(semgrepScannerAdapter);
	},
	isApplicable({ finding }) {
		if (finding.sourceTool !== "semgrep") {
			return { applicable: false, reason: "Not a Semgrep finding." };
		}
		const loc = finding.primaryLocation as Record<string, unknown> | null;
		const filepath = loc?.path as string | undefined;
		if (!filepath || filepath.trim() === "") {
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
				"/opt/vuln-workbench/scanner-data/semgrep-rules",
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

			for (const result of normalized) {
				if (
					result.ruleId === origRuleId &&
					result.primaryLocation.path === origPath
				) {
					matched = true;
					if (result.primaryLocation.startLine === origStartLine) {
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
		} catch (error) {
			return {
				outcome: "inconclusive",
				metadata: {
					error: `Normalization failed: ${(error as Error).message}`,
				},
			};
		}
	},
};
