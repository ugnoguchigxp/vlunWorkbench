import { describe, expect, test } from "bun:test";
import { scoreBenchmark } from "../api/modules/benchmarks/metric-scorer";
import {
	assertMetricArtifactIntegrity,
	type MetricArtifact,
} from "./professional-capability-artifact-verifier";

function validArtifact(): MetricArtifact {
	return scoreBenchmark(
		[
			{
				testId: "vulnerable",
				category: "authorization",
				cwe: "CWE-284",
				vulnerable: true,
			},
			{
				testId: "fixed",
				category: "authorization",
				cwe: "CWE-284",
				vulnerable: false,
			},
		],
		[
			{
				testId: "vulnerable",
				category: "authorization",
				cwe: "CWE-284",
			},
		],
	);
}

describe("professional capability artifact verifier", () => {
	test("accepts a self-consistent scorer artifact", () => {
		expect(() => assertMetricArtifactIntegrity(validArtifact())).not.toThrow();
	});

	test("rejects altered arithmetic and output hashes", () => {
		const arithmeticMismatch = validArtifact();
		const overall = arithmeticMismatch.metrics.find(
			(metric) => metric.category === "overall",
		);
		expect(overall).toBeDefined();
		if (overall) overall.recall = 0;
		expect(() => assertMetricArtifactIntegrity(arithmeticMismatch)).toThrow(
			"benchmark_metric_arithmetic_mismatch",
		);

		const hashMismatch = validArtifact();
		hashMismatch.outputHash = `sha256:${"0".repeat(64)}`;
		expect(() => assertMetricArtifactIntegrity(hashMismatch)).toThrow(
			"benchmark_metric_output_hash_mismatch",
		);
	});
});
