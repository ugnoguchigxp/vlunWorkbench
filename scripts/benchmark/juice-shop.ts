import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import { loadScannerDataManifest } from "../../api/modules/scans/tools/scanner-provenance";
import { verifyPreparedCorpora } from "../security-corpora-lib";
import { gitCommit, sha256, sha256Tree } from "./benchmark-input-provenance";
import {
	isCompletedJuiceShopObservation,
	juiceShopObservationsSchema,
	juiceShopRunReportSchema,
	summarizeJuiceShopObservations,
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./juice-shop-observations";
import {
	loadAndValidateJuiceShopInputs,
	validateJuiceShopCatalogAgainstUpstream,
} from "./juice-shop-playbooks";
import { runJuiceShopScenarios } from "./juice-shop-runner";
import { assessJuiceShopMeasurement } from "./measurement-status";

const artifactsRoot = path.resolve(".artifacts/benchmark");
const evidenceRoot = path.join(artifactsRoot, "juice-shop-evidence");
const observationsPath = path.join(
	artifactsRoot,
	"juice-shop-observations.json",
);
const runReportPath = path.join(artifactsRoot, "juice-shop-run.json");
const metricsPath = path.join(artifactsRoot, "juice-shop-metrics.json");
const catalogPath = "spec/security-capability/juice-shop-ground-truth.v1.json";
const policyPath = "spec/security-capability/benchmark-policy.v1.json";
await rm(evidenceRoot, { recursive: true, force: true });
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

const corporaRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
const upstreamChallengesPath = path.join(
	corporaRoot,
	"owasp-juice-shop/source/data/static/challenges.yml",
);
const [
	verifiedCorpora,
	inputs,
	manifest,
	catalogBytes,
	policyBytes,
	upstreamChallengesBytes,
] = await Promise.all([
	verifyPreparedCorpora({
		outputRoot: corporaRoot,
		ids: ["owasp-juice-shop"],
	}),
	loadAndValidateJuiceShopInputs(),
	loadScannerDataManifest(),
	readFile(catalogPath),
	readFile(policyPath),
	readFile(upstreamChallengesPath),
]);
validateJuiceShopCatalogAgainstUpstream(
	inputs.catalog,
	upstreamChallengesBytes.toString("utf8"),
);
const policy = JSON.parse(policyBytes.toString("utf8")) as {
	policyVersion: string;
	minimums: Record<string, number>;
};
const categoryCount = new Set(
	inputs.catalog.scenarios.map((scenario) => scenario.category),
).size;
if (categoryCount < 8)
	throw new Error("juice_shop_category_coverage_insufficient");

const run = await runJuiceShopScenarios({
	catalog: inputs.catalog,
	playbooks: inputs.playbooks,
	evidenceRoot,
});
const observations = juiceShopObservationsSchema.parse(run.observations);
const observationBytes = Buffer.from(
	`${JSON.stringify(observations, null, 2)}\n`,
);
await Bun.write(observationsPath, observationBytes, { mode: 0o600 });
const byScenario = validateJuiceShopObservations(
	observations,
	inputs.catalog.scenarios.map((scenario) => scenario.id),
);
await verifyJuiceShopEvidenceFiles(
	byScenario.values(),
	evidenceRoot,
	new Map(
		inputs.playbooks.map((playbook) => [
			playbook.scenarioId,
			playbook.controlId,
		]),
	),
);

const counts = summarizeJuiceShopObservations(observations, {
	eligibleScenarioCount: inputs.catalog.scenarios.length,
	categoryCount,
});
const measurement = assessJuiceShopMeasurement(counts, {
	preflightStatus: run.preflight.status,
});
const metricsGenerated = measurement.status === "completed";
const provenance = {
	gitCommit: await gitCommit(),
	corpusVersion: inputs.catalog.corpusVersion,
	corpusDigest: requiredDigest(
		verifiedCorpora[0]?.archiveSha256,
		"juice_shop_corpus_digest_missing",
	),
	upstreamGroundTruthHash: requiredDigest(
		verifiedCorpora[0]?.groundTruthSha256,
		"juice_shop_ground_truth_digest_missing",
	),
	benchmarkPolicyVersion: policy.policyVersion,
	benchmarkPolicyHash: sha256(policyBytes),
	catalogHash: sha256(catalogBytes),
	playbookHash: await sha256Tree(["scripts/benchmark/juice-shop-playbooks.ts"]),
	fixedFixtureHash: await sha256Tree([
		"tests/security-capability/juice-shop/paired-fixtures.json",
		"tests/security-capability/juice-shop/fixed-app",
	]),
	detectorImplementationHash: await sha256Tree([
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
	scannerManifestHash: manifest.manifestHash,
	observationsHash: sha256(observationBytes),
	evidenceBundleHash: await sha256Tree([evidenceRoot]),
	fixtureImageDigest: run.preflight.image,
};

let score: ReturnType<typeof scoreBenchmark> | null = null;
let gatePassed = false;
if (metricsGenerated) {
	const groundTruth = inputs.catalog.scenarios.flatMap((scenario) =>
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
	const detected = inputs.catalog.scenarios.flatMap((scenario) => {
		const observation = byScenario.get(scenario.id);
		if (!observation || !isCompletedJuiceShopObservation(observation))
			return [];
		return scenario.cwe.flatMap((cwe) => [
			...(observation.vulnerable.detection === "detected"
				? [
						{
							testId: scenario.id,
							category: scenario.category,
							cwe,
						},
					]
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
	score = scoreBenchmark(groundTruth, detected);
	const overall = score.metrics.find((metric) => metric.category === "overall");
	gatePassed =
		run.preflight.status === "passed" &&
		counts.eligibleScenarioCount >=
			policy.minimums.juiceShopEligibleScenarios &&
		counts.categoryCount >= policy.minimums.juiceShopCategories &&
		counts.executedScenarioCount === counts.eligibleScenarioCount &&
		(overall?.recall ?? -1) >= policy.minimums.juiceShopRecall &&
		(overall?.precision ?? -1) >= policy.minimums.juiceShopPrecision &&
		counts.externalNetworkRequests === 0 &&
		counts.publicProductionRequests === 0 &&
		counts.credentialCanaryLeakageCount === 0;
	await Bun.write(
		metricsPath,
		`${JSON.stringify(
			{
				schemaVersion: 2,
				corpusId: "owasp-juice-shop",
				measurementStatus: "completed",
				...provenance,
				...counts,
				resetSucceeded: true,
				networkRequests: 0,
				...score,
			},
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
} else {
	await rm(metricsPath, { force: true });
}

const report = juiceShopRunReportSchema.parse({
	schemaVersion: 2,
	evidenceKind: "juice_shop_benchmark_run",
	generatedAt: new Date().toISOString(),
	measurementStatus: measurement.status,
	measurementReason: measurement.reason,
	provenance,
	counts,
	preflight: run.preflight,
	metricsGenerated,
	gatePassed,
	observations,
});
await Bun.write(runReportPath, `${JSON.stringify(report, null, 2)}\n`, {
	mode: 0o600,
});
console.log(
	JSON.stringify({
		ok: true,
		runReportPath,
		metricsPath: metricsGenerated ? metricsPath : null,
		measurementStatus: measurement.status,
		gatePassed,
		counts,
		overall: score?.metrics.find((metric) => metric.category === "overall"),
	}),
);

function requiredDigest(value: string | undefined, errorCode: string): string {
	if (!value) throw new Error(errorCode);
	return value;
}
