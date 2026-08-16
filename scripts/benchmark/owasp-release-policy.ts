import { z } from "zod";
import type { BenchmarkMetric } from "../../shared/schemas/benchmark.schema";

export const owaspReleasePolicySchema = z
	.object({
		policyVersion: z.string().min(1),
		minimums: z.object({
			owaspOverallRecall: z.number().min(0).max(1),
			owaspOverallPrecision: z.number().min(0).max(1),
			owaspOverallFalsePositiveRate: z.number().min(0).max(1),
			owaspScore: z.number().min(-1).max(1),
			owaspCategoryRecall: z.number().min(0).max(1),
			owaspCategoryGroundTruthMinimum: z.number().int().positive(),
		}),
		applicability: z.object({
			semgrep: z.array(z.string().min(1)).min(1),
		}),
	})
	.passthrough();

export type OwaspReleasePolicy = z.infer<typeof owaspReleasePolicySchema>;

export function assertOwaspMetricsPassReleasePolicy(
	metrics: BenchmarkMetric[],
	policy: OwaspReleasePolicy,
): void {
	const metricsByCategory = new Map<string, BenchmarkMetric>();
	for (const metric of metrics) {
		if (metricsByCategory.has(metric.category)) {
			throw new Error(
				`owasp_release_policy_duplicate_category:${metric.category}`,
			);
		}
		metricsByCategory.set(metric.category, metric);
	}
	const overall = metricsByCategory.get("overall");
	if (
		!overall ||
		overall.recall === null ||
		overall.precision === null ||
		overall.falsePositiveRate === null ||
		overall.score === null ||
		overall.recall < policy.minimums.owaspOverallRecall ||
		overall.precision < policy.minimums.owaspOverallPrecision ||
		overall.falsePositiveRate > policy.minimums.owaspOverallFalsePositiveRate ||
		overall.score < policy.minimums.owaspScore
	) {
		throw new Error("owasp_release_policy_overall_not_met");
	}

	for (const category of new Set(policy.applicability.semgrep)) {
		const metric = metricsByCategory.get(category);
		if (!metric) {
			throw new Error(`owasp_release_policy_category_missing:${category}`);
		}
		if (
			metric.truePositive + metric.falseNegative <
			policy.minimums.owaspCategoryGroundTruthMinimum
		) {
			continue;
		}
		if (
			metric.recall === null ||
			metric.recall < policy.minimums.owaspCategoryRecall
		) {
			throw new Error(`owasp_release_policy_category_not_met:${category}`);
		}
	}
}
