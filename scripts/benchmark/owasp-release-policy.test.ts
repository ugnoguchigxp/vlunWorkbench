import { describe, expect, test } from "bun:test";
import type { BenchmarkMetric } from "../../shared/schemas/benchmark.schema";
import {
	assertOwaspMetricsPassReleasePolicy,
	type OwaspReleasePolicy,
} from "./owasp-release-policy";

const policy: OwaspReleasePolicy = {
	policyVersion: "1.0.0",
	minimums: {
		owaspOverallRecall: 0.7,
		owaspOverallPrecision: 0.8,
		owaspOverallFalsePositiveRate: 0.1,
		owaspScore: 0.6,
		owaspCategoryRecall: 0.5,
		owaspCategoryGroundTruthMinimum: 20,
	},
	applicability: { semgrep: ["sqli", "xss"] },
};

function metrics(): BenchmarkMetric[] {
	return [
		{
			category: "overall",
			truePositive: 80,
			falseNegative: 20,
			trueNegative: 95,
			falsePositive: 5,
			recall: 0.8,
			precision: 80 / 85,
			falsePositiveRate: 0.05,
			score: 0.75,
		},
		{
			category: "sqli",
			truePositive: 15,
			falseNegative: 5,
			trueNegative: 20,
			falsePositive: 0,
			recall: 0.75,
			precision: 1,
			falsePositiveRate: 0,
			score: 0.75,
		},
		{
			category: "xss",
			truePositive: 5,
			falseNegative: 0,
			trueNegative: 5,
			falsePositive: 0,
			recall: 1,
			precision: 1,
			falsePositiveRate: 0,
			score: 1,
		},
	];
}

describe("OWASP release policy", () => {
	test("accepts overall and applicable category metrics that meet policy", () => {
		expect(() =>
			assertOwaspMetricsPassReleasePolicy(metrics(), policy),
		).not.toThrow();
	});

	test("rejects an overall policy failure before persistence", () => {
		const failed = metrics();
		const overall = failed[0];
		if (!overall) throw new Error("test_metric_missing");
		overall.precision = 0.79;
		expect(() =>
			assertOwaspMetricsPassReleasePolicy(failed, policy),
		).toThrow("owasp_release_policy_overall_not_met");
	});

	test("rejects an applicable category recall failure", () => {
		const failed = metrics();
		const category = failed[1];
		if (!category) throw new Error("test_metric_missing");
		category.recall = 0.49;
		expect(() =>
			assertOwaspMetricsPassReleasePolicy(failed, policy),
		).toThrow("owasp_release_policy_category_not_met:sqli");
	});

	test("rejects missing and duplicate category evidence", () => {
		expect(() =>
			assertOwaspMetricsPassReleasePolicy(metrics().slice(0, 2), policy),
		).toThrow("owasp_release_policy_category_missing:xss");
		expect(() =>
			assertOwaspMetricsPassReleasePolicy(
				[...metrics(), { ...(metrics()[1] as BenchmarkMetric) }],
				policy,
			),
		).toThrow("owasp_release_policy_duplicate_category:sqli");
	});
});
