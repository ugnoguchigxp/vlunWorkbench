import { describe, expect, test } from "bun:test";
import { analyzeOwaspFailures } from "./owasp-failure-analysis-lib";

describe("OWASP failure analysis", () => {
	test("separates mapped safe and cross-CWE observations without double counting", () => {
		const report = analyzeOwaspFailures(
			[
				{
					testId: "BenchmarkTest00001",
					category: "sqli",
					cwe: "CWE-89",
					vulnerable: true,
				},
				{
					testId: "BenchmarkTest00002",
					category: "sqli",
					cwe: "CWE-89",
					vulnerable: false,
				},
				{
					testId: "BenchmarkTest00003",
					category: "pathtraver",
					cwe: "CWE-22",
					vulnerable: true,
				},
			],
			[
				raw("BenchmarkTest00001", "rule-a", "CWE-89"),
				raw("BenchmarkTest00001", "rule-b", "CWE-89"),
				raw("BenchmarkTest00001", "rule-xss", "CWE-79"),
				raw("BenchmarkTest00002", "rule-a", "CWE-89"),
				raw("BenchmarkTest00002", "rule-a", "CWE-89"),
			],
		);
		expect(report.falseNegativeCount).toBe(1);
		expect(report.falsePositiveCount).toBe(2);
		expect(report.mappedSafeFalsePositiveCount).toBe(1);
		expect(report.unmappedCrossCweCount).toBe(1);
		expect(report.falsePositivesByRule).toEqual({
			"rule-a": 1,
			"rule-xss": 1,
		});
		const ruleA = report.ruleContributions.find(
			(entry) => entry.ruleId === "rule-a",
		);
		expect(ruleA).toMatchObject({
			mappedSafe: 1,
			unmappedCrossCwe: 0,
			total: 1,
			unique: 1,
			truePositive: 1,
			uniqueTruePositive: 0,
		});
		expect(ruleA?.hypotheticalDisable.allowedForAutomaticAction).toBe(false);
	});
});

function raw(testId: string, ruleId: string, cwe: string) {
	return {
		check_id: ruleId,
		path: `/corpus/${testId}.java`,
		extra: { metadata: { cwe } },
	};
}
