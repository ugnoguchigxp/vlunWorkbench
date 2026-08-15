import {
	normalizeCwe,
	scoreBenchmark,
	type BenchmarkGroundTruth,
	type BenchmarkObservation,
} from "../../api/modules/benchmarks/metric-scorer";

export type OwaspRawResult = {
	check_id?: string;
	path?: string;
	start?: { line?: number };
	extra?: { metadata?: { cwe?: string | string[] } };
};

type ObservationKind = "mapped_safe" | "unmapped_cross_cwe";

export type OwaspFailureAnalysis = {
	falseNegativeCount: number;
	falsePositiveCount: number;
	mappedSafeFalsePositiveCount: number;
	unmappedCrossCweCount: number;
	falseNegativesByCategory: Record<string, number>;
	falsePositivesByCategory: Record<string, number>;
	falsePositivesByRule: Record<string, number>;
	ruleContributions: Array<{
		ruleId: string;
		mappedSafe: number;
		unmappedCrossCwe: number;
		total: number;
		unique: number;
		overlapping: number;
		truePositive: number;
		uniqueTruePositive: number;
		hypotheticalDisable: {
			falsePositiveReduction: number;
			truePositiveLoss: number;
			remainingFalsePositive: number;
			remainingTruePositive: number;
			allowedForAutomaticAction: false;
		};
	}>;
	falseNegativeTestIds: string[];
	falsePositiveObservationKeys: string[];
};

export function analyzeOwaspFailures(
	expected: BenchmarkGroundTruth[],
	rawResults: OwaspRawResult[],
): OwaspFailureAnalysis {
	const expectedByTest = new Map(
		expected.map((entry) => [entry.testId, entry]),
	);
	const observations: BenchmarkObservation[] = [];
	const rulesByObservation = new Map<string, Set<string>>();
	for (const result of rawResults) {
		const testId = result.path?.match(/BenchmarkTest\d{5}/)?.[0];
		const truth = testId ? expectedByTest.get(testId) : undefined;
		if (!testId || !truth) continue;
		const cwes = Array.isArray(result.extra?.metadata?.cwe)
			? result.extra.metadata.cwe
			: result.extra?.metadata?.cwe
				? [result.extra.metadata.cwe]
				: [];
		for (const cweValue of cwes) {
			const cwe = normalizeCwe(cweValue);
			observations.push({ testId, category: truth.category, cwe });
			const key = observationKey(truth.category, testId, cwe);
			const rules = rulesByObservation.get(key) ?? new Set<string>();
			rules.add(result.check_id ?? "unknown-rule");
			rulesByObservation.set(key, rules);
		}
	}
	const score = scoreBenchmark(expected, observations);
	const falseNegatives = expected.filter(
		(entry) =>
			entry.vulnerable &&
			!rulesByObservation.has(
				observationKey(entry.category, entry.testId, entry.cwe),
			),
	);
	const falsePositiveKinds = new Map<string, ObservationKind>();
	for (const entry of expected) {
		const key = observationKey(entry.category, entry.testId, entry.cwe);
		if (!entry.vulnerable && rulesByObservation.has(key)) {
			falsePositiveKinds.set(key, "mapped_safe");
		}
	}
	for (const observation of score.unmappedObservations) {
		falsePositiveKinds.set(
			observationKey(observation.category, observation.testId, observation.cwe),
			"unmapped_cross_cwe",
		);
	}
	const truePositiveKeys = new Set(
		expected
			.filter((entry) => entry.vulnerable)
			.map((entry) => observationKey(entry.category, entry.testId, entry.cwe))
			.filter((key) => rulesByObservation.has(key)),
	);
	const allRules = new Set<string>();
	for (const rules of rulesByObservation.values())
		for (const rule of rules) allRules.add(rule);
	const ruleContributions = [...allRules]
		.map((ruleId) => {
			const falsePositiveKeys = [...falsePositiveKinds].filter(([key]) =>
				rulesByObservation.get(key)?.has(ruleId),
			);
			const truePositiveForRule = [...truePositiveKeys].filter((key) =>
				rulesByObservation.get(key)?.has(ruleId),
			);
			const uniqueFalsePositive = falsePositiveKeys.filter(
				([key]) => rulesByObservation.get(key)?.size === 1,
			).length;
			const uniqueTruePositive = truePositiveForRule.filter(
				(key) => rulesByObservation.get(key)?.size === 1,
			).length;
			return {
				ruleId,
				mappedSafe: falsePositiveKeys.filter(
					([, kind]) => kind === "mapped_safe",
				).length,
				unmappedCrossCwe: falsePositiveKeys.filter(
					([, kind]) => kind === "unmapped_cross_cwe",
				).length,
				total: falsePositiveKeys.length,
				unique: uniqueFalsePositive,
				overlapping: falsePositiveKeys.length - uniqueFalsePositive,
				truePositive: truePositiveForRule.length,
				uniqueTruePositive,
				hypotheticalDisable: {
					falsePositiveReduction: uniqueFalsePositive,
					truePositiveLoss: uniqueTruePositive,
					remainingFalsePositive: falsePositiveKinds.size - uniqueFalsePositive,
					remainingTruePositive: truePositiveKeys.size - uniqueTruePositive,
					allowedForAutomaticAction: false as const,
				},
			};
		})
		.filter((entry) => entry.total > 0 || entry.truePositive > 0)
		.sort(
			(left, right) =>
				right.total - left.total || left.ruleId.localeCompare(right.ruleId),
		);
	const falsePositiveKeys = [...falsePositiveKinds.keys()];
	const report: OwaspFailureAnalysis = {
		falseNegativeCount: falseNegatives.length,
		falsePositiveCount: falsePositiveKinds.size,
		mappedSafeFalsePositiveCount: [...falsePositiveKinds.values()].filter(
			(kind) => kind === "mapped_safe",
		).length,
		unmappedCrossCweCount: [...falsePositiveKinds.values()].filter(
			(kind) => kind === "unmapped_cross_cwe",
		).length,
		falseNegativesByCategory: countBy(
			falseNegatives.map((entry) => entry.category),
		),
		falsePositivesByCategory: countBy(
			falsePositiveKeys.map((key) => key.split(":", 1)[0] ?? "unknown"),
		),
		falsePositivesByRule: countBy(
			falsePositiveKeys.flatMap((key) => [
				...(rulesByObservation.get(key) ?? ["unknown-rule"]),
			]),
		),
		ruleContributions,
		falseNegativeTestIds: falseNegatives.map((entry) => entry.testId).sort(),
		falsePositiveObservationKeys: falsePositiveKeys.sort(),
	};
	const overall = score.metrics.find((metric) => metric.category === "overall");
	if (
		overall?.falseNegative !== report.falseNegativeCount ||
		overall.falsePositive !== report.falsePositiveCount ||
		report.mappedSafeFalsePositiveCount + report.unmappedCrossCweCount !==
			report.falsePositiveCount
	) {
		throw new Error("owasp_failure_analysis_reconciliation_failed");
	}
	return report;
}

function observationKey(category: string, testId: string, cwe: string): string {
	return `${category}:${testId}:${cwe}`;
}

function countBy(values: Iterable<string>): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return Object.fromEntries(
		Object.entries(counts).sort(
			([left, leftCount], [right, rightCount]) =>
				rightCount - leftCount || left.localeCompare(right),
		),
	);
}
