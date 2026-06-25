import { describe, expect, it } from "vitest";
import type { findings } from "../../db/schema";
import { getReproductionProfileById, listReproductionProfiles } from "./profiles";

describe("Reproduction Profiles Registry", () => {
	it("should list all four mandatory profiles", () => {
		const profiles = listReproductionProfiles();
		expect(profiles).toHaveLength(4);
		const ids = profiles.map((p) => p.id);
		expect(ids).toContain("semgrep-path-recheck");
		expect(ids).toContain("gitleaks-recheck");
		expect(ids).toContain("osv-dependency-recheck");
		expect(ids).toContain("trivy-fs-recheck");
	});

	describe("semgrep-path-recheck", () => {
		const profile = getReproductionProfileById("semgrep-path-recheck")!;

		it("is applicable for semgrep findings with relative path", () => {
			const finding = {
				sourceTool: "semgrep",
				primaryLocation: { path: "src/index.js" },
			} as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(true);
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
				"auto",
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
	});

	describe("gitleaks-recheck", () => {
		const profile = getReproductionProfileById("gitleaks-recheck")!;

		it("is applicable for gitleaks findings", () => {
			const finding = { sourceTool: "gitleaks" } as unknown as typeof findings.$inferSelect;
			const res = profile.isApplicable({ finding });
			expect(res.applicable).toBe(true);
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
		});
	});
});
