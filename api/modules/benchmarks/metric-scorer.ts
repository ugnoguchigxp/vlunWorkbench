import crypto from "node:crypto";
import type { BenchmarkMetric } from "../../../shared/schemas/benchmark.schema";
import { benchmarkMetricSchema } from "../../../shared/schemas/benchmark.schema";
import { canonicalJson } from "../scans/diff-scan-plan";

export type BenchmarkGroundTruth = {
	testId: string;
	category: string;
	cwe: string;
	vulnerable: boolean;
};

export type BenchmarkObservation = {
	testId: string;
	category: string;
	cwe: string;
};

export type BenchmarkScore = {
	metrics: BenchmarkMetric[];
	unmappedObservations: BenchmarkObservation[];
	outputHash: string;
};

export function scoreBenchmark(
	groundTruth: BenchmarkGroundTruth[],
	observations: BenchmarkObservation[],
): BenchmarkScore {
	assertGroundTruth(groundTruth);
	const truthByKey = new Map(
		groundTruth.map((entry) => [truthKey(entry.testId, entry.cwe), entry]),
	);
	const mapped = new Set<string>();
	const unmappedByKey = new Map<string, BenchmarkObservation>();
	for (const observation of observations) {
		const key = truthKey(observation.testId, observation.cwe);
		if (!truthByKey.has(key)) {
			unmappedByKey.set(`${observation.category}:${key}`, observation);
			continue;
		}
		mapped.add(key);
	}
	const unmappedObservations = [...unmappedByKey.values()];
	const categories = [
		...new Set([
			...groundTruth.map((entry) => entry.category),
			...unmappedObservations.map((entry) => entry.category),
		]),
	].sort();
	const metrics = categories.map((category) =>
		buildMetric(
			category,
			groundTruth.filter((entry) => entry.category === category),
			mapped,
			unmappedObservations.filter((entry) => entry.category === category)
				.length,
		),
	);
	metrics.push(
		buildMetric("overall", groundTruth, mapped, unmappedObservations.length),
	);
	const parsed = metrics.map((metric) => benchmarkMetricSchema.parse(metric));
	const output = {
		metrics: parsed,
		unmappedObservations: [...unmappedObservations].sort(compareObservation),
	};
	return {
		...output,
		outputHash: sha256(canonicalJson(output)),
	};
}

function buildMetric(
	category: string,
	truth: BenchmarkGroundTruth[],
	mapped: Set<string>,
	unmappedFalsePositive: number,
): BenchmarkMetric {
	let truePositive = 0;
	let falseNegative = 0;
	let trueNegative = 0;
	let falsePositive = unmappedFalsePositive;
	for (const entry of truth) {
		const detected = mapped.has(truthKey(entry.testId, entry.cwe));
		if (entry.vulnerable && detected) truePositive++;
		else if (entry.vulnerable) falseNegative++;
		else if (detected) falsePositive++;
		else trueNegative++;
	}
	const recall = ratio(truePositive, truePositive + falseNegative);
	const precision = ratio(truePositive, truePositive + falsePositive);
	const falsePositiveRate = ratio(falsePositive, falsePositive + trueNegative);
	return {
		category,
		truePositive,
		falseNegative,
		trueNegative,
		falsePositive,
		recall,
		precision,
		falsePositiveRate,
		score:
			recall === null || falsePositiveRate === null
				? null
				: recall - falsePositiveRate,
	};
}

function assertGroundTruth(groundTruth: BenchmarkGroundTruth[]): void {
	const keys = new Set<string>();
	for (const entry of groundTruth) {
		const key = truthKey(entry.testId, entry.cwe);
		if (keys.has(key)) throw new Error(`duplicate_ground_truth:${key}`);
		keys.add(key);
	}
	if (groundTruth.length === 0) throw new Error("ground_truth_empty");
}

function truthKey(testId: string, cwe: string): string {
	return `${testId.trim()}:${normalizeCwe(cwe)}`;
}

export function normalizeCwe(value: string | number): string {
	const digits = String(value).match(/\d+/)?.[0];
	if (!digits) throw new Error(`invalid_cwe:${value}`);
	return `CWE-${Number(digits)}`;
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function sha256(value: string): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function compareObservation(
	left: BenchmarkObservation,
	right: BenchmarkObservation,
): number {
	return (
		left.category.localeCompare(right.category) ||
		left.testId.localeCompare(right.testId) ||
		left.cwe.localeCompare(right.cwe)
	);
}
