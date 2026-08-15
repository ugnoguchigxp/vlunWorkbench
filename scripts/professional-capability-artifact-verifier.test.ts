import { describe, expect, test } from "bun:test";
import { scoreBenchmark } from "../api/modules/benchmarks/metric-scorer";
import {
	assertMetricArtifactIntegrity,
	isAuthoritativeJuiceShopReleaseRun,
	type MetricArtifact,
} from "./professional-capability-artifact-verifier";
import { juiceShopRunReportSchema } from "./benchmark/juice-shop-observations";

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

	test("accepts only complete same-commit authoritative Juice Shop evidence", () => {
		const report = validJuiceShopReport();
		expect(
			isAuthoritativeJuiceShopReleaseRun({
				report,
				releaseCommit: "a".repeat(40),
				workingTreeClean: true,
			}),
		).toBe(true);

		for (const mutate of [
			(value: typeof report) => {
				value.measurementStatus = "blocked";
			},
			(value: typeof report) => {
				value.preflight.authoritativeLinux = false;
			},
			(value: typeof report) => {
				value.counts.externalNetworkRequests = 1;
			},
		]) {
			const invalid = structuredClone(report);
			mutate(invalid);
			expect(
				isAuthoritativeJuiceShopReleaseRun({
					report: invalid,
					releaseCommit: "a".repeat(40),
					workingTreeClean: true,
				}),
			).toBe(false);
		}
		expect(
			isAuthoritativeJuiceShopReleaseRun({
				report,
				releaseCommit: "b".repeat(40),
				workingTreeClean: true,
			}),
		).toBe(false);
		expect(
			isAuthoritativeJuiceShopReleaseRun({
				report,
				releaseCommit: "a".repeat(40),
				workingTreeClean: false,
			}),
		).toBe(false);
	});
});

function validJuiceShopReport() {
	const digest = `sha256:${"a".repeat(64)}`;
	return juiceShopRunReportSchema.parse({
		schemaVersion: 2,
		evidenceKind: "juice_shop_benchmark_run",
		generatedAt: new Date(0).toISOString(),
		measurementStatus: "completed",
		measurementReason: null,
		provenance: {
			gitCommit: "a".repeat(40),
			corpusVersion: "20.1.1",
			corpusDigest: digest,
			upstreamGroundTruthHash: digest,
			benchmarkPolicyVersion: "1.0.0",
			benchmarkPolicyHash: digest,
			catalogHash: digest,
			playbookHash: digest,
			fixedFixtureHash: digest,
			detectorImplementationHash: digest,
			scannerManifestHash: digest,
			observationsHash: digest,
			evidenceBundleHash: digest,
			fixtureImageDigest: `example.test/juice@${digest}`,
		},
		counts: {
			eligibleScenarioCount: 20,
			categoryCount: 9,
			observationCount: 20,
			executedScenarioCount: 20,
			detectedScenarioCount: 12,
			blockedScenarioCount: 0,
			inconclusiveScenarioCount: 0,
			failedCleanupScenarioCount: 0,
			targetRequestCount: 80,
			externalNetworkRequests: 0,
			publicProductionRequests: 0,
			credentialCanaryLeakageCount: 0,
		},
		preflight: {
			status: "passed",
			platform: "linux",
			fixtureId: "juice-shop-20.1.1",
			image: `example.test/juice@${digest}`,
			targetOrigin: "http://127.0.0.1:3000",
			authoritativeLinux: true,
			errorCode: null,
		},
		metricsGenerated: true,
		gatePassed: true,
		observations: [],
	});
}
