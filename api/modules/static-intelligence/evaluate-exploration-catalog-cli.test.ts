import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const FIXTURE_PATH = path.resolve(
	process.cwd(),
	"tests/fixtures/scans/exploration-catalog-evaluation.json",
);

describe("Project exploration catalog evaluator CLI", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) =>
				fs.rm(directory, { recursive: true, force: true }),
			),
		);
	});

	it("returns deterministic machine-readable metrics", () => {
		const first = runEvaluator(FIXTURE_PATH);
		const second = runEvaluator(FIXTURE_PATH);

		expect(first.status).toBe(0);
		expect(first.stderr).toBe("");
		expect(second.status).toBe(0);
		expect(first.stdout).toBe(second.stdout);
		expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, caseCount: 2 });
	});

	it("rejects empty, duplicate, and non-project-relative evidence cases", async () => {
		const source = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
			cases: Array<Record<string, unknown>>;
		};
		const firstCase = source.cases[0];
		if (!firstCase) throw new Error("evaluation fixture is empty");
		const invalidFixtures = [
			{ cases: [] },
			{ cases: [firstCase, structuredClone(firstCase)] },
			{
				cases: [
					{
						...firstCase,
						caseId: "unsafe-path",
						actualChangedFiles: ["/tmp/private.ts"],
					},
				],
			},
		];

		for (const fixture of invalidFixtures) {
			const fixturePath = await writeTempFixture(fixture);
			const result = runEvaluator(fixturePath);
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({
				ok: false,
				reasonCode: "invalid_fixture",
			});
		}
	});

	async function writeTempFixture(value: unknown): Promise<string> {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "exploration-catalog-evaluator-"),
		);
		tempDirs.push(directory);
		const fixturePath = path.join(directory, "fixture.json");
		await fs.writeFile(fixturePath, JSON.stringify(value));
		return fixturePath;
	}
});

function runEvaluator(fixturePath: string) {
	return spawnSync(
		process.execPath,
		[
			"scripts/evaluate-exploration-catalog.ts",
			"--",
			"--fixture",
			fixturePath,
		],
		{
			cwd: process.cwd(),
			encoding: "utf8",
		},
	);
}
