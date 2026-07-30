import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import { verifyPreparedCorpora } from "../security-corpora-lib";

const corporaRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
await verifyPreparedCorpora({
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
const observationsSchema = z.array(
	z.object({
		scenarioId: z.string(),
		vulnerableDetected: z.boolean(),
		fixedDetected: z.boolean(),
		evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	}),
);

const catalog = catalogSchema.parse(
	JSON.parse(
		await readFile(
			"spec/security-capability/juice-shop-ground-truth.v1.json",
			"utf8",
		),
	),
);
const categoryCount = new Set(catalog.scenarios.map((item) => item.category))
	.size;
if (categoryCount < 8)
	throw new Error("juice_shop_category_coverage_insufficient");
const observationPath = path.resolve(
	process.env.VULN_WORKBENCH_JUICE_SHOP_OBSERVATIONS ??
		".artifacts/benchmark/juice-shop-observations.json",
);
const observations = observationsSchema.parse(
	JSON.parse(await readFile(observationPath, "utf8").catch(() => "[]")),
);
const byScenario = new Map(observations.map((item) => [item.scenarioId, item]));
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
const outputPath = path.resolve(".artifacts/benchmark/juice-shop-metrics.json");
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			corpusId: "owasp-juice-shop",
			corpusVersion: catalog.corpusVersion,
			eligibleScenarioCount: catalog.scenarios.length,
			categoryCount,
			executedScenarioCount: observations.length,
			networkMode: "isolated",
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
		executedScenarioCount: observations.length,
		overall: score.metrics.find((metric) => metric.category === "overall"),
	}),
);
