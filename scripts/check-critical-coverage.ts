import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	criticalCoverageTargetBaseline,
	criticalCoverageTargets,
	criticalCoverageTests,
} from "./critical-coverage-policy";

if (criticalCoverageTargets.length < criticalCoverageTargetBaseline) {
	throw new Error(
		`Critical coverage target count regressed: ${criticalCoverageTargets.length} < ${criticalCoverageTargetBaseline}.`,
	);
}

const coverageDirectory = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-coverage-"),
);
try {
	const processResult = Bun.spawn(
		[
			"bun",
			"test",
			"--coverage",
			"--coverage-reporter=lcov",
			`--coverage-dir=${coverageDirectory}`,
			...criticalCoverageTests,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if ((await processResult.exited) !== 0) process.exit(1);

	const lcov = await readFile(
		path.join(coverageDirectory, "lcov.info"),
		"utf8",
	);
	const records = lcov.split("end_of_record");
	const results = [];
	for (const { path: target, minimum } of criticalCoverageTargets) {
		const record = records.find((candidate) =>
			candidate.includes(`SF:${target}\n`),
		);
		if (!record) throw new Error(`Coverage record is missing: ${target}`);
		const lines = [...record.matchAll(/^DA:\d+,(\d+)/gm)].map((match) =>
			Number(match[1]),
		);
		const hit = lines.filter((count) => count > 0).length;
		const percent = lines.length === 0 ? 0 : (hit / lines.length) * 100;
		results.push({ target, hit, total: lines.length, percent, minimum });
	}
	const failed = results.filter((result) => result.percent < result.minimum);
	process.stdout.write(
		`${JSON.stringify({
			scopeKind: "critical_api",
			ok: failed.length === 0,
			targetCount: criticalCoverageTargets.length,
			targetBaseline: criticalCoverageTargetBaseline,
			results,
		})}\n`,
	);
	if (failed.length > 0) process.exitCode = 1;
} finally {
	await rm(coverageDirectory, { recursive: true, force: true });
}
