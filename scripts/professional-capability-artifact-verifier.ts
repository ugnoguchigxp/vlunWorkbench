import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scoreBenchmark } from "../api/modules/benchmarks/metric-scorer";
import { canonicalJson } from "../api/modules/scans/diff-scan-plan";
import { benchmarkMetricSchema } from "../shared/schemas/benchmark.schema";
import {
	juiceShopObservationsSchema,
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./benchmark/juice-shop-observations";

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
	networkRequests?: number;
	resetSucceeded?: boolean;
	upstreamGroundTruthHash?: string;
	catalogHash?: string;
	observationsHash?: string;
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

export async function verifyOwaspArtifactIntegrity(params: {
	artifact: MetricArtifact;
	manifestHash: string;
	corpusLock: Record<string, unknown>;
}): Promise<void> {
	const corpus = (
		params.corpusLock.corpora as Array<Record<string, unknown>> | undefined
	)?.find((item) => item.id === "owasp-benchmark-java");
	const expectedFindingsPath = path.resolve(
		".artifacts/benchmark/owasp-findings.json",
	);
	const rawScannerArtifactPath = path.resolve(
		".artifacts/benchmark/owasp-semgrep-raw.json",
	);
	if (
		!corpus ||
		params.artifact.corpusDigest !== corpus.archiveSha256 ||
		params.artifact.expectedResultsHash !== corpus.groundTruthSha256 ||
		params.artifact.scannerManifestHash !== params.manifestHash ||
		params.artifact.findingsPath !== expectedFindingsPath ||
		params.artifact.networkRequests !== 0 ||
		params.artifact.resetSucceeded !== true ||
		typeof params.artifact.findingsHash !== "string" ||
		typeof params.artifact.rawScannerArtifactHash !== "string"
	)
		throw new Error("owasp_benchmark_provenance_mismatch");
	const [findingsHash, rawScannerArtifactHash] = await Promise.all([
		sha256(await readFile(expectedFindingsPath)),
		sha256(await readFile(rawScannerArtifactPath)),
	]);
	if (
		params.artifact.findingsHash !== findingsHash ||
		params.artifact.rawScannerArtifactHash !== rawScannerArtifactHash
	)
		throw new Error("owasp_benchmark_artifact_hash_mismatch");
}

export async function verifyJuiceShopArtifactIntegrity(params: {
	artifact: MetricArtifact;
	manifestHash: string;
	corpusLock: Record<string, unknown>;
}): Promise<void> {
	const corpus = (
		params.corpusLock.corpora as Array<Record<string, unknown>> | undefined
	)?.find((item) => item.id === "owasp-juice-shop");
	const catalogPath = path.resolve(
		"spec/security-capability/juice-shop-ground-truth.v1.json",
	);
	const observationsPath = path.resolve(
		".artifacts/benchmark/juice-shop-observations.json",
	);
	const [catalogBytes, observationBytes] = await Promise.all([
		readFile(catalogPath),
		readFile(observationsPath).catch(() => Buffer.from("[]")),
	]);
	const catalog = JSON.parse(catalogBytes.toString("utf8")) as {
		scenarios?: Array<{ id: string; category: string; cwe: string[] }>;
	};
	const observations = juiceShopObservationsSchema.parse(
		JSON.parse(observationBytes.toString("utf8")),
	);
	const byScenario = validateJuiceShopObservations(
		observations,
		(catalog.scenarios ?? []).map((scenario) => scenario.id),
	);
	await verifyJuiceShopEvidenceFiles(
		byScenario.values(),
		path.resolve(".artifacts/benchmark/juice-shop-evidence"),
	);
	const scenarios = catalog.scenarios ?? [];
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
		if (!observation) return [];
		return scenario.cwe.flatMap((cwe) => [
			...(observation.vulnerableDetected
				? [{ testId: scenario.id, category: scenario.category, cwe }]
				: []),
			...(observation.fixedDetected
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
	if (
		!corpus ||
		params.artifact.corpusDigest !== corpus.archiveSha256 ||
		params.artifact.upstreamGroundTruthHash !== corpus.groundTruthSha256 ||
		params.artifact.scannerManifestHash !== params.manifestHash ||
		params.artifact.catalogHash !== sha256(catalogBytes) ||
		params.artifact.observationsHash !== sha256(observationBytes) ||
		params.artifact.outputHash !== expectedScore.outputHash ||
		params.artifact.eligibleScenarioCount !== scenarios.length ||
		params.artifact.categoryCount !==
			new Set(scenarios.map((scenario) => scenario.category)).size ||
		params.artifact.executedScenarioCount !== byScenario.size ||
		params.artifact.networkRequests !== 0 ||
		params.artifact.resetSucceeded !== true
	)
		throw new Error("juice_shop_benchmark_provenance_mismatch");
}

function ratio(numerator: number, denominator: number): number | null {
	return denominator === 0 ? null : numerator / denominator;
}

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
