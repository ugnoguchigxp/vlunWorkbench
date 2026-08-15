import { describe, expect, it } from "vitest";
import type { findings } from "../../db/schema";
import { semgrepReproductionProfile } from "../../plugins/scanners/semgrep-reproduction-profile";
import {
	createReproductionProfiles,
	getReproductionProfileById,
	listReproductionProfiles,
} from "./profiles";

describe("Reproduction Profiles Registry", () => {
	it("keeps optional Semgrep out of the default profile list", () => {
		const profiles = listReproductionProfiles();
		expect(profiles).toHaveLength(3);
		const ids = profiles.map((p) => p.id);
		expect(ids).not.toContain("semgrep-path-recheck");
		expect(ids).toContain("gitleaks-recheck");
		expect(ids).toContain("osv-dependency-recheck");
		expect(ids).toContain("trivy-fs-recheck");
	});

	it("adds the Semgrep recheck only through explicit optional configuration", () => {
		expect(
			createReproductionProfiles({ includeOptionalSemgrep: true }).map(
				(profile) => profile.id,
			),
		).toContain("semgrep-path-recheck");
	});

	describe("semgrep-path-recheck", () => {
		const profile = semgrepReproductionProfile;

		it("is applicable for semgrep findings with relative path", () => {
			const finding = {
				sourceTool: "semgrep",
				primaryLocation: { path: "src/index.js" },
			} as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(true);
		});

		it("is not applicable if primaryLocation is missing or empty path", () => {
			const finding1 = {
				sourceTool: "semgrep",
				primaryLocation: null,
			} as unknown as typeof findings.$inferSelect;
			const res1 = profile.isApplicable({ finding: finding1 });
			expect(res1.applicable).toBe(false);
			expect(res1.reason).toContain("missing a primary location path");

			const finding2 = {
				sourceTool: "semgrep",
				primaryLocation: { path: "" },
			} as unknown as typeof findings.$inferSelect;
			const res2 = profile.isApplicable({ finding: finding2 });
			expect(res2.applicable).toBe(false);
		});

		it("is not applicable for non-semgrep findings", () => {
			const finding = {
				sourceTool: "gitleaks",
				primaryLocation: { path: "src/index.js" },
			} as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
			expect(res.reason).toContain("Not a Semgrep finding");
		});

		it("is not applicable for path traversal attempts", () => {
			const finding = {
				sourceTool: "semgrep",
				primaryLocation: { path: "../etc/passwd" },
			} as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
			expect(res.reason).toContain("not a safe relative path");
		});

		it("builds the correct command args", () => {
			const finding = {
				sourceTool: "semgrep",
				primaryLocation: { path: "src/index.js" },
			} as unknown as typeof findings.$inferSelect;
			const cmd = profile.buildCommand({
				repoPath: "/host/repo",
				outputPath: "/host/out.json",
				finding,
			});
			expect(cmd.binaryName).toBe("semgrep");
			expect(cmd.args).toEqual([
				"scan",
				"--config",
				"/opt/vuln-workbench/scanner-data/semgrep-rules",
				"--json",
				"--output",
				"/host/out.json",
				"--include",
				"src/index.js",
				"/host/repo",
			]);
		});

		it("evaluates exact match and path_rule match correctly", () => {
			const finding = {
				ruleId: "rules-1",
				primaryLocation: { path: "src/index.js", startLine: 10 },
			} as unknown as typeof findings.$inferSelect;
			const rawOutput = {
				results: [
					{
						check_id: "rules-1",
						path: "src/index.js",
						start: { line: 10, col: 1 },
						end: { line: 10, col: 5 },
						extra: { message: "vuln", severity: "ERROR" },
					},
				],
			};

			const evalResult = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(evalResult.outcome).toBe("reproduced");
			expect(evalResult.metadata?.matchStrength).toBe("exact");

			const rawOutputDiffLine = {
				results: [
					{
						check_id: "rules-1",
						path: "src/index.js",
						start: { line: 20, col: 1 },
						end: { line: 20, col: 5 },
						extra: { message: "vuln", severity: "ERROR" },
					},
				],
			};
			const evalResultDiffLine = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput: rawOutputDiffLine,
			});
			expect(evalResultDiffLine.outcome).toBe("reproduced");
			expect(evalResultDiffLine.metadata?.matchStrength).toBe("path_rule");
		});

		it("evaluates non-reproduced correctly", () => {
			const finding = {
				ruleId: "rules-1",
				primaryLocation: { path: "src/index.js", startLine: 10 },
			} as unknown as typeof findings.$inferSelect;
			const rawOutput = { results: [] };
			const evalResult = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(evalResult.outcome).toBe("not_reproduced");
			expect(evalResult.metadata?.matchStrength).toBe("none");
		});

		it("handles evaluate errors", () => {
			const evalResult = profile.evaluate({
				finding: {} as any,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput: null,
			});
			expect(evalResult.outcome).toBe("inconclusive");
		});
	});

	describe("gitleaks-recheck", () => {
		const profile = getReproductionProfileById("gitleaks-recheck")!;

		it("is applicable for gitleaks findings", () => {
			const finding = { sourceTool: "gitleaks" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(true);
		});

		it("is not applicable for non-gitleaks findings", () => {
			const finding = { sourceTool: "semgrep" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
		});

		it("builds the correct command", () => {
			const cmd = profile.buildCommand({
				repoPath: "/host/repo",
				outputPath: "/host/out.json",
				finding: {} as unknown as typeof findings.$inferSelect,
			});
			expect(cmd.binaryName).toBe("gitleaks");
			expect(cmd.args).toContain("/host/repo");
			expect(cmd.args).toContain("/host/out.json");
		});

		it("evaluates match outcome correctly", () => {
			const finding = {
				ruleId: "generic-api-key",
				primaryLocation: { path: "src/keys.txt" },
			} as unknown as typeof findings.$inferSelect;
			const rawOutput = [
				{
					RuleID: "generic-api-key",
					File: "src/keys.txt",
					StartLine: 1,
					EndLine: 1,
				},
			];
			const evalResult = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(evalResult.outcome).toBe("reproduced");
			expect(evalResult.metadata?.matchStrength).toBe("exact");
		});

		it("evaluates match without origPath correctly", () => {
			const finding = {
				ruleId: "generic-api-key",
				primaryLocation: null,
			} as unknown as typeof findings.$inferSelect;
			const rawOutput = [
				{
					RuleID: "generic-api-key",
					File: "src/keys.txt",
					StartLine: 1,
					EndLine: 1,
				},
			];
			const evalResult = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(evalResult.outcome).toBe("reproduced");
			expect(evalResult.metadata?.matchStrength).toBe("rule_only");
		});

		it("evaluates non-match correctly", () => {
			const finding = {
				ruleId: "generic-api-key",
				primaryLocation: { path: "src/keys.txt" },
			} as unknown as typeof findings.$inferSelect;
			const rawOutput = [
				{
					RuleID: "different-rule",
					File: "src/keys.txt",
					StartLine: 1,
					EndLine: 1,
				},
			];
			const evalResult = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(evalResult.outcome).toBe("not_reproduced");
		});

		it("handles evaluation failure by returning inconclusive", () => {
			const evalResult = profile.evaluate({
				finding: {} as any,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput: null,
			});
			expect(evalResult.outcome).toBe("inconclusive");
		});
	});

	describe("osv-dependency-recheck", () => {
		const profile = getReproductionProfileById("osv-dependency-recheck")!;

		it("is applicable for osv findings with packageName or advisoryId", () => {
			const finding1 = {
				sourceTool: "osv",
				metadata: { packageName: "axios" },
				ruleId: "CVE-2023-12345",
			} as unknown as typeof findings.$inferSelect;
			expect(profile.isApplicable({ finding: finding1 }).applicable).toBe(true);

			const finding2 = {
				sourceTool: "osv",
				metadata: {},
				ruleId: "CVE-2023-12345",
			} as unknown as typeof findings.$inferSelect;
			expect(profile.isApplicable({ finding: finding2 }).applicable).toBe(true);
		});

		it("is not applicable for non-osv findings", () => {
			const finding = { sourceTool: "semgrep" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
			expect(res.reason).toContain("Not an OSV finding");
		});

		it("is not applicable if packageName and advisoryId/ruleId are missing", () => {
			const finding = {
				sourceTool: "osv",
				metadata: {},
				ruleId: "",
			} as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
			expect(res.reason).toContain("missing packageName or advisoryId");
		});

		it("builds the correct command", () => {
			const cmd = profile.buildCommand({
				repoPath: "/host/repo",
				outputPath: "/host/out.json",
				finding: {} as any,
			});
			expect(cmd.binaryName).toBe("osv-scanner");
			expect(cmd.args).toContain("/host/repo");
			expect(cmd.args).toContain("/host/out.json");
		});

		it("evaluates exact match and rule_only match correctly", () => {
			const finding = {
				ruleId: "CVE-2023-12345",
				metadata: { packageName: "axios" },
			} as unknown as typeof findings.$inferSelect;

			const rawOutput = {
				results: [
					{
						source: { path: "package-lock.json", type: "npm" },
						packages: [
							{
								package: { name: "axios", version: "0.21.1" },
								vulnerabilities: [
									{ id: "CVE-2023-12345", details: "DoS" },
								],
							},
						],
					},
				],
			};

			const res1 = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res1.outcome).toBe("reproduced");
			expect(res1.metadata?.matchStrength).toBe("exact");

			const findingNoPkg = {
				ruleId: "CVE-2023-12345",
				metadata: {},
			} as unknown as typeof findings.$inferSelect;
			const res2 = profile.evaluate({
				finding: findingNoPkg,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res2.outcome).toBe("reproduced");
			expect(res2.metadata?.matchStrength).toBe("rule_only");
		});

		it("evaluates non-match correctly", () => {
			const finding = {
				ruleId: "CVE-2023-12345",
				metadata: { packageName: "axios" },
			} as unknown as typeof findings.$inferSelect;

			const rawOutput = {
				results: [
					{
						source: { path: "package-lock.json", type: "npm" },
						packages: [
							{
								package: { name: "lodash", version: "4.17.21" },
								vulnerabilities: [
									{ id: "CVE-2021-23337", details: "Prototype pollution" },
								],
							},
						],
					},
				],
			};

			const res = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res.outcome).toBe("not_reproduced");
		});

		it("handles evaluate errors", () => {
			const res = profile.evaluate({
				finding: {} as any,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput: null,
			});
			expect(res.outcome).toBe("inconclusive");
		});
	});

	describe("trivy-fs-recheck", () => {
		const profile = getReproductionProfileById("trivy-fs-recheck")!;

		it("is applicable for trivy findings", () => {
			const finding = { sourceTool: "trivy" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(true);
		});

		it("is not applicable for non-trivy findings", () => {
			const finding = { sourceTool: "semgrep" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(false);
		});

		it("builds the correct command", () => {
			const cmd = profile.buildCommand({
				repoPath: "/host/repo",
				outputPath: "/host/out.json",
				finding: {} as any,
			});
			expect(cmd.binaryName).toBe("trivy");
			expect(cmd.args).toContain("/host/repo");
			expect(cmd.args).toContain("/host/out.json");
		});

		it("evaluates exact match by package and ruleId correctly", () => {
			const finding = {
				ruleId: "CVE-2023-12345",
				metadata: { packageName: "axios" },
				primaryLocation: { path: "package.json" },
			} as unknown as typeof findings.$inferSelect;

			const rawOutput = {
				Results: [
					{
						Target: "package.json",
						Vulnerabilities: [
							{
								VulnerabilityID: "CVE-2023-12345",
								PkgName: "axios",
							},
						],
					},
				],
			};

			const res = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res.outcome).toBe("reproduced");
			expect(res.metadata?.matchStrength).toBe("exact");
		});

		it("evaluates exact match by path and ruleId correctly when package is missing", () => {
			const finding = {
				ruleId: "CVE-2023-12345",
				metadata: {},
				primaryLocation: { path: "package.json" },
			} as unknown as typeof findings.$inferSelect;

			const rawOutput = {
				Results: [
					{
						Target: "package.json",
						Vulnerabilities: [
							{
								VulnerabilityID: "CVE-2023-12345",
								PkgName: "axios",
							},
						],
					},
				],
			};

			const res = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res.outcome).toBe("reproduced");
			expect(res.metadata?.matchStrength).toBe("exact");
		});

		it("evaluates rule_only match when path/package differs", () => {
			const finding = {
				ruleId: "CVE-2023-12345",
				metadata: { packageName: "axios" },
				primaryLocation: { path: "package.json" },
			} as unknown as typeof findings.$inferSelect;

			const rawOutput = {
				Results: [
					{
						Target: "other-package.json",
						Vulnerabilities: [
							{
								VulnerabilityID: "CVE-2023-12345",
								PkgName: "different-pkg",
							},
						],
					},
				],
			};

			const res = profile.evaluate({
				finding,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput,
			});
			expect(res.outcome).toBe("reproduced");
			expect(res.metadata?.matchStrength).toBe("rule_only");
		});

		it("handles evaluate errors", () => {
			const res = profile.evaluate({
				finding: {} as any,
				stdout: "",
				stderr: "",
				exitCode: 0,
				rawOutput: null,
			});
			expect(res.outcome).toBe("inconclusive");
		});
	});
});
