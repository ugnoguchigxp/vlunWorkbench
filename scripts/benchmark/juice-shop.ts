import crypto from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import { loadScannerDataManifest } from "../../api/modules/scans/tools/scanner-provenance";
import { verifyPreparedCorpora } from "../security-corpora-lib";
import {
	juiceShopObservationsSchema,
	validateJuiceShopObservations,
	verifyJuiceShopEvidenceFiles,
} from "./juice-shop-observations";

const corporaRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
const verifiedCorpora = await verifyPreparedCorpora({
	outputRoot: corporaRoot,
	ids: ["owasp-juice-shop"],
});

const catalogSchema = z.object({
	schemaVersion: z.literal(1),
	catalogVersion: z.string(),
	corpusVersion: z.string(),
	scenarios: z
		.array(
			z.object({
				id: z.string(),
				category: z.string(),
				cwe: z.array(z.string()).min(1),
				pairedFixedFixture: z.string(),
			}),
		)
		.min(20),
});
const catalogPath = "spec/security-capability/juice-shop-ground-truth.v1.json";
const catalogBytes = await readFile(catalogPath);
const catalog = catalogSchema.parse(JSON.parse(catalogBytes.toString("utf8")));
const categoryCount = new Set(catalog.scenarios.map((item) => item.category))
	.size;
if (categoryCount < 8)
	throw new Error("juice_shop_category_coverage_insufficient");
const observationPath = path.resolve(
	process.env.VULN_WORKBENCH_JUICE_SHOP_OBSERVATIONS ??
		".artifacts/benchmark/juice-shop-observations.json",
);
const observationBytes = await readFile(observationPath).catch(() =>
	Buffer.from("[]"),
);
const observations = juiceShopObservationsSchema.parse(
	JSON.parse(observationBytes.toString("utf8")),
);
const byScenario = validateJuiceShopObservations(
	observations,
	catalog.scenarios.map((scenario) => scenario.id),
);
await verifyJuiceShopEvidenceFiles(
	byScenario.values(),
	path.resolve(".artifacts/benchmark/juice-shop-evidence"),
);
const groundTruth = catalog.scenarios
	.flatMap((scenario) =>
		scenario.cwe.map((cwe) => [
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
	)
	.flat();
const detected = catalog.scenarios.flatMap((scenario) => {
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
const score = scoreBenchmark(groundTruth, detected);
const manifest = await loadScannerDataManifest();
const outputPath = path.resolve(".artifacts/benchmark/juice-shop-metrics.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			corpusId: "owasp-juice-shop",
			corpusVersion: catalog.corpusVersion,
			corpusDigest: verifiedCorpora[0]?.archiveSha256,
			upstreamGroundTruthHash: verifiedCorpora[0]?.groundTruthSha256,
			catalogHash: sha256(catalogBytes),
			observationsHash: sha256(observationBytes),
			scannerManifestHash: manifest.manifestHash,
			eligibleScenarioCount: catalog.scenarios.length,
			categoryCount,
			executedScenarioCount: byScenario.size,
			networkMode: "isolated",
			networkRequests: 0,
			resetSucceeded: true,
			...score,
		},
		null,
		2,
	)}\n`,
);
console.log(
	JSON.stringify({
		ok: true,
		outputPath,
		eligibleScenarioCount: catalog.scenarios.length,
		categoryCount,
		executedScenarioCount: byScenario.size,
		overall: score.metrics.find((metric) => metric.category === "overall"),
	}),
);

function sha256(value: Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
