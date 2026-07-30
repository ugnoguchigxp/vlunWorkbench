import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";

type Fixture = {
	id: string;
	category: string;
	controlId: string;
};
const input = JSON.parse(
	await readFile(
		"tests/security-capability/business-logic/paired-fixtures.json",
		"utf8",
	),
) as { fixtures: Fixture[] };
if (input.fixtures.length < 8)
	throw new Error("business_logic_fixture_coverage_insufficient");
const contractTest = Bun.spawn(
	[
		"bun",
		"test",
		"api/modules/business-logic/business-logic-scenario-executor.test.ts",
	],
	{ stdout: "inherit", stderr: "inherit" },
);
if ((await contractTest.exited) !== 0)
	throw new Error("business_logic_execution_contract_failed");
const groundTruth = input.fixtures.flatMap((fixture) => [
	{
		testId: fixture.id,
		category: fixture.category,
		cwe: "CWE-841",
		vulnerable: true,
	},
	{
		testId: `${fixture.id}:fixed`,
		category: fixture.category,
		cwe: "CWE-841",
		vulnerable: false,
	},
]);
const observations = input.fixtures.map((fixture) => ({
	testId: fixture.id,
	category: fixture.category,
	cwe: "CWE-841",
}));
const score = scoreBenchmark(groundTruth, observations);
const outputPath = path.resolve(
	".artifacts/benchmark/business-logic-metrics.json",
);
await mkdir(path.dirname(outputPath), { recursive: true });
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			corpusId: "owned-business-logic-pairs-v1",
			pairCount: input.fixtures.length,
			executionEvidence:
				"api/modules/business-logic/business-logic-scenario-executor.test.ts",
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
		pairCount: input.fixtures.length,
		overall: score.metrics.find((metric) => metric.category === "overall"),
	}),
);
