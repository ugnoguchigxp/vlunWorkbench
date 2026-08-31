import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scoreBenchmark } from "../api/modules/benchmarks/metric-scorer";
import {
	buildOwaspCweCategoryMap,
	mapSemgrepFindingToObservation,
	parseOwaspExpectedResults,
} from "../api/modules/benchmarks/owasp-benchmark-adapter";
import { canonicalJson } from "../api/modules/scans/diff-scan-plan";
import { benchmarkMetricSchema } from "../shared/schemas/benchmark.schema";
import {
	gitCommit as benchmarkGitCommit,
	sha256File,
	sha256Tree,
} from "./benchmark/benchmark-input-provenance";
import {
	isCompletedJuiceShopObservation,
	type JuiceShopRunReport,
	juiceShopObservationsSchema,
	juiceShopRunReportSchema,
	summarizeJuiceShopObservations,
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./benchmark/juice-shop-observations";
import {
	JUICE_SHOP_PLAYBOOKS,
	juiceShopCatalogSchema,
	validateJuiceShopCatalogAgainstUpstream,
} from "./benchmark/juice-shop-playbooks";
import { assessJuiceShopMeasurement } from "./benchmark/measurement-status";
import { sanitizedSemgrepEvidenceArtifactSchema } from "./benchmark/owasp-benchmark-runtime";

export type Metric = {
	category: string;
	truePositive: number;
	falseNegative: number;
	trueNegative: number;
	falsePositive: number;
	recall: number | null;
	precision: number | null;
	falsePositiveRate: number | null;
	score: number | null;
};

export type MetricArtifact = {
	metrics: Metric[];
	eligibleScenarioCount?: number;
	categoryCount?: number;
	executedScenarioCount?: number;
	corpusDigest?: string;
	outputHash?: string;
	rawScannerArtifactHash?: string | null;
	unmappedObservations?: unknown[];
	expectedResultsHash?: string;
	scannerManifestHash?: string;
	findingsPath?: string;
	findingsHash?: string;
	normalizedFindingSnapshotHash?: string;
	networkRequests?: number;
	resetSucceeded?: boolean;
	upstreamGroundTruthHash?: string;
	catalogHash?: string;
	observationsHash?: string;
	gitCommit?: string;
	policyHash?: string;
	implementationHash?: string;
	measurementStatus?: string;
	benchmarkPolicyVersion?: string;
	benchmarkPolicyHash?: string;
	playbookHash?: string;
	fixedFixtureHash?: string;
	detectorImplementationHash?: string;
	evidenceBundleHash?: string;
	fixtureImageDigest?: string;
	observationCount?: number;
	detectedScenarioCount?: number;
	blockedScenarioCount?: number;
	inconclusiveScenarioCount?: number;
	failedCleanupScenarioCount?: number;
	targetRequestCount?: number;
	externalNetworkRequests?: number;
	publicProductionRequests?: number;
	credentialCanaryLeakageCount?: number;
};

const metricArtifactSchema = z
	.object({
		metrics: z.array(benchmarkMetricSchema).min(1),
		outputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
		unmappedObservations: z.array(z.unknown()).default([]),
	})
	.passthrough();

export async function readMetricArtifact(
	filePath: string,
): Promise<MetricArtifact | null> {
	return (await stat(filePath).catch(() => null))
		? (metricArtifactSchema.parse(
				JSON.parse(await readFile(filePath, "utf8")),
			) as MetricArtifact)
		: null;
}

export function overall(artifact: MetricArtifact | null): Metric | null {
	return artifact?.metrics.find((item) => item.category === "overall") ?? null;
}

export function isAuthoritativeJuiceShopReleaseRun(params: {
	report: JuiceShopRunReport | null;
	releaseCommit: string;
	workingTreeClean: boolean;
}): boolean {
	const report = params.report;
	return Boolean(
		report &&
			params.workingTreeClean &&
			report.measurementStatus === "completed" &&
			report.metricsGenerated &&
			report.gatePassed &&
			report.preflight.status === "passed" &&
			report.preflight.authoritativeLinux &&
			report.provenance.gitCommit === params.releaseCommit &&
			report.counts.executedScenarioCount ===
				report.counts.eligibleScenarioCount &&
			report.counts.blockedScenarioCount === 0 &&
			report.counts.inconclusiveScenarioCount === 0 &&
			report.counts.failedCleanupScenarioCount === 0 &&
			report.counts.externalNetworkRequests === 0 &&
			report.counts.publicProductionRequests === 0 &&
			report.counts.credentialCanaryLeakageCount === 0,
	);
}

export function assertMetricArtifactIntegrity(artifact: MetricArtifact): void {
	for (const metric of artifact.metrics) {
		const expectedRecall = ratio(
			metric.truePositive,
			metric.truePositive + metric.falseNegative,
		);
		const expectedPrecision = ratio(
			metric.truePositive,
			metric.truePositive + metric.falsePositive,
		);
		const expectedFalsePositiveRate = ratio(
			metric.falsePositive,
			metric.falsePositive + metric.trueNegative,
		);
		const expectedScore =
			expectedRecall === null || expectedFalsePositiveRate === null
				? null
				: expectedRecall - expectedFalsePositiveRate;
		for (const [actual, expected] of [
			[metric.recall, expectedRecall],
			[metric.precision, expectedPrecision],
			[metric.falsePositiveRate, expectedFalsePositiveRate],
			[metric.score, expectedScore],
		] as const)
			if (
				actual !== expected &&
				(actual === null ||
					expected === null ||
					Math.abs(actual - expected) > Number.EPSILON * 8)
			)
				throw new Error("benchmark_metric_arithmetic_mismatch");
	}
	const expectedOutputHash = sha256(
		new TextEncoder().encode(
			canonicalJson({
				metrics: artifact.metrics,
				unmappedObservations: artifact.unmappedObservations ?? [],
			}),
		),
	);
	if (artifact.outputHash !== expectedOutputHash)
		throw new Error("benchmark_metric_output_hash_mismatch");
}

export function assertOwaspMetricArtifactMatchesInputs(params: {
	artifact: MetricArtifact;
	expectedResultsCsv: string;
	findings: unknown;
}): void {
	const findings = z
		.array(
			z
				.object({
					path: z.string().min(1),
					cwe: z.union([z.string(), z.number()]),
					category: z.string().min(1),
				})
				.strict(),
		)
		.parse(params.findings);
	const expected = parseOwaspExpectedResults(params.expectedResultsCsv);
	const categoryByCwe = buildOwaspCweCategoryMap(expected);
	const observations = findings
		.map((finding) => mapSemgrepFindingToObservation(finding, categoryByCwe))
		.filter((value) => value !== null);
	const expectedScore = scoreBenchmark(expected, observations);
	const normalizedFindingSnapshotHash = sha256(
		new TextEncoder().encode(canonicalJson(observations)),
	);
	if (
		params.artifact.outputHash !== expectedScore.outputHash ||
		params.artifact.normalizedFindingSnapshotHash !==
			normalizedFindingSnapshotHash ||
		canonicalJson(params.artifact.metrics) !==
			canonicalJson(expectedScore.metrics) ||
		canonicalJson(params.artifact.unmappedObservations ?? []) !==
			canonicalJson(expectedScore.unmappedObservations)
	)
		throw new Error("owasp_benchmark_score_recomputation_mismatch");
}

export async function verifyOwaspArtifactIntegrity(params: {
	artifact: MetricArtifact;
	manifestHash: string;
	corpusLock: Record<string, unknown>;
}): Promise<void> {
	assertMetricArtifactIntegrity(params.artifact);
	const corpus = (
		params.corpusLock.corpora as Array<Record<string, unknown>> | undefined
	)?.find((item) => item.id === "owasp-benchmark-java");
	const expectedFindingsPath = path.resolve(
		".artifacts/benchmark/owasp-findings.json",
	);
	const expectedFindingsEvidencePath =
		".artifacts/benchmark/owasp-findings.json";
	const rawScannerArtifactPath = path.resolve(
		".artifacts/benchmark/owasp-semgrep-raw.json",
	);
	const expectedResultsPath = path.resolve(
		process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ??
			".cache/security-corpora",
		"owasp-benchmark-java/source/expectedresults-1.2beta.csv",
	);
	if (
		!corpus ||
		params.artifact.corpusDigest !== corpus.archiveSha256 ||
		params.artifact.expectedResultsHash !== corpus.groundTruthSha256 ||
		params.artifact.scannerManifestHash !== params.manifestHash ||
		params.artifact.findingsPath !== expectedFindingsEvidencePath ||
		params.artifact.networkRequests !== 0 ||
		params.artifact.resetSucceeded !== true ||
		typeof params.artifact.findingsHash !== "string" ||
		typeof params.artifact.rawScannerArtifactHash !== "string"
	)
		throw new Error("owasp_benchmark_provenance_mismatch");
	const [
		expectedResultsBytes,
		findingsBytes,
		findingsHash,
		rawScannerArtifactBytes,
		policyHash,
		implementationHash,
		currentCommit,
	] = await Promise.all([
		readFile(expectedResultsPath),
		readFile(expectedFindingsPath),
		sha256(await readFile(expectedFindingsPath)),
		readFile(rawScannerArtifactPath),
		sha256File("spec/security-capability/benchmark-policy.v1.json"),
		sha256Tree([
			"docker/toolbox/scanner-data/semgrep-rules/java",
			"scripts/benchmark/owasp-benchmark.ts",
			"scripts/benchmark/owasp-benchmark-input.ts",
			"scripts/benchmark/owasp-benchmark-runtime.ts",
			"scripts/benchmark/owasp-release-policy.ts",
			"api/modules/benchmarks/metric-scorer.ts",
			"api/modules/benchmarks/owasp-benchmark-adapter.ts",
			"api/modules/scans/tools/java-taint-precision-filter.ts",
			"scripts/benchmark/benchmark-input-provenance.ts",
		]),
		benchmarkGitCommit(),
	]);
	const rawScannerArtifactHash = sha256(rawScannerArtifactBytes);
	sanitizedSemgrepEvidenceArtifactSchema.parse(
		JSON.parse(rawScannerArtifactBytes.toString("utf8")),
	);
	if (
		params.artifact.expectedResultsHash !== sha256(expectedResultsBytes) ||
		params.artifact.findingsHash !== findingsHash ||
		params.artifact.rawScannerArtifactHash !== rawScannerArtifactHash ||
		params.artifact.policyHash !== policyHash ||
		params.artifact.implementationHash !== implementationHash ||
		params.artifact.gitCommit !== currentCommit
	)
		throw new Error("owasp_benchmark_artifact_hash_mismatch");
	assertOwaspMetricArtifactMatchesInputs({
		artifact: params.artifact,
		expectedResultsCsv: expectedResultsBytes.toString("utf8"),
		findings: JSON.parse(findingsBytes.toString("utf8")),
	});
}

export async function verifyJuiceShopArtifactIntegrity(params: {
	artifact: MetricArtifact;
	manifestHash: string;
	corpusLock: Record<string, unknown>;
}): Promise<JuiceShopRunReport> {
	assertMetricArtifactIntegrity(params.artifact);
	const corpus = (
		params.corpusLock.corpora as Array<Record<string, unknown>> | undefined
	)?.find((item) => item.id === "owasp-juice-shop");
	const catalogPath = path.resolve(
		"spec/security-capability/juice-shop-ground-truth.v1.json",
	);
	const observationsPath = path.resolve(
		".artifacts/benchmark/juice-shop-observations.json",
	);
	const runReportPath = path.resolve(
		".artifacts/benchmark/juice-shop-run.json",
	);
	const evidenceRoot = path.resolve(".artifacts/benchmark/juice-shop-evidence");
	const policyPath = "spec/security-capability/benchmark-policy.v1.json";
	const upstreamChallengesPath = path.resolve(
		process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ??
			".cache/security-corpora",
		"owasp-juice-shop/source/data/static/challenges.yml",
	);
	const [
		catalogBytes,
		observationBytes,
		policyBytes,
		runReportBytes,
		upstreamChallengesBytes,
	] = await Promise.all([
		readFile(catalogPath),
		readFile(observationsPath),
		readFile(policyPath),
		readFile(runReportPath),
		readFile(upstreamChallengesPath),
	]);
	const catalog = juiceShopCatalogSchema.parse(
		JSON.parse(catalogBytes.toString("utf8")),
	);
	validateJuiceShopCatalogAgainstUpstream(
		catalog,
		upstreamChallengesBytes.toString("utf8"),
	);
	const observations = juiceShopObservationsSchema.parse(
		JSON.parse(observationBytes.toString("utf8")),
	);
	const report = juiceShopRunReportSchema.parse(
		JSON.parse(runReportBytes.toString("utf8")),
	);
	const policy = z
		.object({
			policyVersion: z.string().min(1),
			minimums: z.object({
				juiceShopEligibleScenarios: z.number().nonnegative(),
				juiceShopCategories: z.number().nonnegative(),
				juiceShopRecall: z.number().min(0).max(1),
				juiceShopPrecision: z.number().min(0).max(1),
			}),
		})
		.passthrough()
		.parse(JSON.parse(policyBytes.toString("utf8")));
	const byScenario = validateJuiceShopObservations(
		observations,
		catalog.scenarios.map((scenario) => scenario.id),
	);
	await verifyJuiceShopEvidenceFiles(
		byScenario.values(),
		evidenceRoot,
		new Map(
			JUICE_SHOP_PLAYBOOKS.map((playbook) => [
				playbook.scenarioId,
				playbook.controlId,
			]),
		),
	);
	const scenarios = catalog.scenarios;
	const groundTruth = scenarios.flatMap((scenario) =>
		scenario.cwe.flatMap((cwe) => [
			{
				testId: scenario.id,
				category: scenario.category,
				cwe,
				vulnerable: true,
			},
			{
				testId: `${scenario.id}:fixed`,
				category: scenario.category,
				cwe,
				vulnerable: false,
			},
		]),
	);
	const detected = scenarios.flatMap((scenario) => {
		const observation = byScenario.get(scenario.id);
		if (!observation || !isCompletedJuiceShopObservation(observation))
			return [];
		return scenario.cwe.flatMap((cwe) => [
			...(observation.vulnerable.detection === "detected"
				? [{ testId: scenario.id, category: scenario.category, cwe }]
				: []),
			...(observation.fixed.detection === "detected"
				? [
						{
							testId: `${scenario.id}:fixed`,
							category: scenario.category,
							cwe,
						},
					]
				: []),
		]);
	});
	const expectedScore = scoreBenchmark(groundTruth, detected);
	const expectedCounts = summarizeJuiceShopObservations(observations, {
		eligibleScenarioCount: scenarios.length,
		categoryCount: new Set(scenarios.map((scenario) => scenario.category)).size,
	});
	const expectedMeasurement = assessJuiceShopMeasurement(expectedCounts, {
		preflightStatus: report.preflight.status,
	});
	const expectedOverall = expectedScore.metrics.find(
		(metric) => metric.category === "overall",
	);
	const expectedGatePassed =
		report.preflight.status === "passed" &&
		expectedMeasurement.status === "completed" &&
		expectedCounts.eligibleScenarioCount >=
			policy.minimums.juiceShopEligibleScenarios &&
		expectedCounts.categoryCount >= policy.minimums.juiceShopCategories &&
		expectedCounts.executedScenarioCount ===
			expectedCounts.eligibleScenarioCount &&
		(expectedOverall?.recall ?? -1) >= policy.minimums.juiceShopRecall &&
		(expectedOverall?.precision ?? -1) >= policy.minimums.juiceShopPrecision &&
		expectedCounts.externalNetworkRequests === 0 &&
		expectedCounts.publicProductionRequests === 0 &&
		expectedCounts.credentialCanaryLeakageCount === 0;
	const [
		playbookHash,
		fixedFixtureHash,
		detectorImplementationHash,
		evidenceBundleHash,
		currentCommit,
	] = await Promise.all([
		sha256Tree(["scripts/benchmark/juice-shop-playbooks.ts"]),
		sha256Tree([
			"tests/security-capability/juice-shop/paired-fixtures.json",
			"tests/security-capability/juice-shop/fixed-app",
		]),
		sha256Tree([
			"api/modules/benchmarks/metric-scorer.ts",
			"api/modules/dast/security-probe-detector.ts",
			"api/modules/runtime-scans/container-fixture-reset.ts",
			"scripts/benchmark/benchmark-input-provenance.ts",
			"scripts/benchmark/juice-shop.ts",
			"scripts/benchmark/juice-shop-runner.ts",
			"scripts/benchmark/juice-shop-evidence.ts",
			"scripts/benchmark/juice-shop-observations.ts",
			"scripts/benchmark/measurement-status.ts",
		]),
		sha256Tree([evidenceRoot]),
		benchmarkGitCommit(),
	]);
	const expectedFixtureImage =
		typeof corpus?.image === "string" && typeof corpus.imageDigest === "string"
			? pinnedImageReference(corpus.image, corpus.imageDigest)
			: null;
	const counts = report.counts;
	const reportObservationsMatch =
		canonicalJson(report.observations) === canonicalJson(observations);
	const reportCountsMatch =
		canonicalJson(counts) === canonicalJson(expectedCounts);
	if (
		!corpus ||
		report.measurementStatus !== "completed" ||
		report.measurementStatus !== expectedMeasurement.status ||
		report.measurementReason !== expectedMeasurement.reason ||
		report.metricsGenerated !== true ||
		report.metricsGenerated !== (expectedMeasurement.status === "completed") ||
		report.gatePassed !== expectedGatePassed ||
		report.gatePassed !== true ||
		report.preflight.status !== "passed" ||
		!reportObservationsMatch ||
		!reportCountsMatch ||
		report.provenance.gitCommit !== currentCommit ||
		report.provenance.corpusVersion !== catalog.corpusVersion ||
		report.provenance.corpusDigest !== corpus.archiveSha256 ||
		report.provenance.upstreamGroundTruthHash !== corpus.groundTruthSha256 ||
		report.provenance.benchmarkPolicyHash !== sha256(policyBytes) ||
		report.provenance.benchmarkPolicyVersion !== policy.policyVersion ||
		report.provenance.catalogHash !== sha256(catalogBytes) ||
		report.provenance.playbookHash !== playbookHash ||
		report.provenance.fixedFixtureHash !== fixedFixtureHash ||
		report.provenance.detectorImplementationHash !==
			detectorImplementationHash ||
		report.provenance.scannerManifestHash !== params.manifestHash ||
		report.provenance.observationsHash !== sha256(observationBytes) ||
		report.provenance.evidenceBundleHash !== evidenceBundleHash ||
		report.provenance.fixtureImageDigest !== expectedFixtureImage ||
		params.artifact.corpusDigest !== corpus.archiveSha256 ||
		params.artifact.upstreamGroundTruthHash !== corpus.groundTruthSha256 ||
		params.artifact.scannerManifestHash !== params.manifestHash ||
		params.artifact.gitCommit !== report.provenance.gitCommit ||
		params.artifact.measurementStatus !== "completed" ||
		params.artifact.benchmarkPolicyVersion !==
			report.provenance.benchmarkPolicyVersion ||
		params.artifact.benchmarkPolicyHash !==
			report.provenance.benchmarkPolicyHash ||
		params.artifact.catalogHash !== report.provenance.catalogHash ||
		params.artifact.playbookHash !== report.provenance.playbookHash ||
		params.artifact.fixedFixtureHash !== report.provenance.fixedFixtureHash ||
		params.artifact.detectorImplementationHash !==
			report.provenance.detectorImplementationHash ||
		params.artifact.observationsHash !== report.provenance.observationsHash ||
		params.artifact.evidenceBundleHash !==
			report.provenance.evidenceBundleHash ||
		params.artifact.fixtureImageDigest !==
			report.provenance.fixtureImageDigest ||
		params.artifact.outputHash !== expectedScore.outputHash ||
		canonicalJson(params.artifact.metrics) !==
			canonicalJson(expectedScore.metrics) ||
		canonicalJson(params.artifact.unmappedObservations ?? []) !==
			canonicalJson(expectedScore.unmappedObservations) ||
		params.artifact.eligibleScenarioCount !== counts.eligibleScenarioCount ||
		params.artifact.categoryCount !== counts.categoryCount ||
		params.artifact.observationCount !== counts.observationCount ||
		params.artifact.executedScenarioCount !== counts.executedScenarioCount ||
		params.artifact.detectedScenarioCount !== counts.detectedScenarioCount ||
		params.artifact.blockedScenarioCount !== counts.blockedScenarioCount ||
		params.artifact.inconclusiveScenarioCount !==
			counts.inconclusiveScenarioCount ||
		params.artifact.failedCleanupScenarioCount !==
			counts.failedCleanupScenarioCount ||
		params.artifact.targetRequestCount !== counts.targetRequestCount ||
		params.artifact.externalNetworkRequests !==
			counts.externalNetworkRequests ||
		params.artifact.publicProductionRequests !==
			counts.publicProductionRequests ||
		params.artifact.credentialCanaryLeakageCount !==
			counts.credentialCanaryLeakageCount ||
		counts.eligibleScenarioCount !== scenarios.length ||
		counts.categoryCount !==
			new Set(scenarios.map((scenario) => scenario.category)).size ||
		counts.executedScenarioCount !== scenarios.length ||
		counts.blockedScenarioCount !== 0 ||
		counts.inconclusiveScenarioCount !== 0 ||
		counts.failedCleanupScenarioCount !== 0 ||
		counts.externalNetworkRequests !== 0 ||
		counts.publicProductionRequests !== 0 ||
		counts.credentialCanaryLeakageCount !== 0 ||
		params.artifact.networkRequests !== 0 ||
		params.artifact.resetSucceeded !== true
	)
		throw new Error("juice_shop_benchmark_provenance_mismatch");
	return report;
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function pinnedImageReference(image: string, digest: string): string {
	const withoutDigest = image.split("@")[0] ?? image;
	const lastSlash = withoutDigest.lastIndexOf("/");
	const lastColon = withoutDigest.lastIndexOf(":");
	const repository =
		lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
	return `${repository}@${digest}`;
}
