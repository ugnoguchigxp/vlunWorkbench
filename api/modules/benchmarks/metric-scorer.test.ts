import { describe, expect, test } from "bun:test";
import { scoreBenchmark } from "./metric-scorer";

describe("benchmark metric scorer", () => {
	test("computes a deterministic confusion matrix and null denominators", () => {
		const groundTruth = [
			{ testId: "a", category: "sqli", cwe: "CWE-89", vulnerable: true },
			{ testId: "b", category: "sqli", cwe: "CWE-89", vulnerable: true },
			{ testId: "c", category: "sqli", cwe: "CWE-89", vulnerable: false },
			{ testId: "d", category: "xss", cwe: "CWE-79", vulnerable: false },
		];
		const observations = [
			{ testId: "a", category: "sqli", cwe: "89" },
			{ testId: "c", category: "sqli", cwe: "CWE-89" },
			{ testId: "unknown", category: "xss", cwe: "CWE-79" },
			{ testId: "unknown", category: "xss", cwe: "CWE-79" },
		];
		const first = scoreBenchmark(groundTruth, observations);
		const second = scoreBenchmark(
			[...groundTruth].reverse(),
			[...observations].reverse(),
		);
		expect(first.metrics.find((metric) => metric.category === "sqli")).toEqual({
			category: "sqli",
			truePositive: 1,
			falseNegative: 1,
			trueNegative: 0,
			falsePositive: 1,
			recall: 0.5,
			precision: 0.5,
			falsePositiveRate: 1,
			score: -0.5,
		});
		expect(first.metrics.find((metric) => metric.category === "xss")).toEqual({
			category: "xss",
			truePositive: 0,
			falseNegative: 0,
			trueNegative: 1,
			falsePositive: 1,
			recall: null,
			precision: 0,
			falsePositiveRate: 0.5,
			score: null,
		});
		expect(first.outputHash).toBe(second.outputHash);
	});

	test("requires non-empty unique ground truth", () => {
		expect(() => scoreBenchmark([], [])).toThrow("ground_truth_empty");
		expect(() =>
			scoreBenchmark(
				[
					{ testId: "a", category: "x", cwe: "1", vulnerable: true },
					{ testId: "a", category: "x", cwe: "1", vulnerable: false },
				],
				[],
			),
		).toThrow("duplicate_ground_truth");
	});
});
