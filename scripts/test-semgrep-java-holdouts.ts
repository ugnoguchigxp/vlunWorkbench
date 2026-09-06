import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { filterOwnedJavaTaintResults } from "../api/modules/scans/tools/java-taint-precision-filter";
import { gitCommit, sha256Tree } from "./benchmark/benchmark-input-provenance";
import { buildPinnedSemgrepRepositoryCommand } from "./benchmark/owasp-benchmark-runtime";

const fixtures = path.resolve("tests/security-capability/java-taint-holdouts");
const outputPath = path.resolve(
	".artifacts/benchmark/java-taint-holdouts.json",
);
{
	const args = [
		"semgrep",
		"scan",
		"--strict",
		"--config",
		"docker/toolbox/scanner-data/semgrep-rules",
		"--json",
		"--quiet",
		"--no-git-ignore",
		...(await readdir(fixtures))
			.filter((file) => file.endsWith(".java"))
			.map((file) => `tests/security-capability/java-taint-holdouts/${file}`),
	];
	const image = process.env.VULN_WORKBENCH_OWASP_SEMGREP_IMAGE;
	const command = image
		? buildPinnedSemgrepRepositoryCommand({
				image,
				repositoryRoot: process.cwd(),
				semgrepArguments: args.slice(1),
			})
		: args;
	const proc = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			SEMGREP_SEND_METRICS: "off",
			SEMGREP_ENABLE_VERSION_CHECK: "0",
		},
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	if (![0, 1].includes(exitCode))
		throw new Error(`holdout_scanner_failed:${stderr.slice(-500)}`);
	const raw = JSON.parse(stdout);
	await mkdir(path.dirname(outputPath), { recursive: true });
	if (!Array.isArray(raw.results) || (raw.errors?.length ?? 0) > 0)
		throw new Error("holdout_scanner_incomplete");
	await Bun.write(
		".artifacts/benchmark/java-taint-holdouts-raw.json",
		JSON.stringify(raw, null, 2),
	);
	const filtered = await filterOwnedJavaTaintResults(raw, {
		projectRoot: fixtures,
	});
	const results = (
		filtered.output as {
			results: Array<{
				check_id: string;
				path: string;
				start: { line: number };
			}>;
		}
	).results;
	const cases: Array<{
		file: string;
		line: number;
		rule: string;
		expected: boolean;
		observed: boolean;
		passed: boolean;
	}> = [];
	for (const file of (await readdir(fixtures))
		.filter((file) => file.endsWith(".java"))
		.sort()) {
		const lines = (await readFile(path.join(fixtures, file), "utf8")).split(
			"\n",
		);
		lines.forEach((line, index) => {
			const marker = line.match(/\/\/ (expect|reject): ([\w-]+)/);
			if (!marker) return;
			const expected = marker[1] === "expect",
				rule = `vuln-workbench.java.${marker[2]}`,
				targetLine = index + 2;
			const observed = results.some(
				(result) =>
					path.basename(result.path) === file &&
					result.start.line === targetLine &&
					result.check_id.endsWith(rule),
			);
			cases.push({
				file,
				line: targetLine,
				rule,
				expected,
				observed,
				passed: expected === observed,
			});
		});
	}
	const ok =
		cases.filter((test) => test.expected).length >= 18 &&
		cases.filter((test) => !test.expected).length >= 10 &&
		cases.every((test) => test.passed);
	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		gitCommit: await gitCommit(),
		fixtureHash: await sha256Tree([fixtures]),
		implementationHash: await sha256Tree([
			"api/modules/scans/tools/java-constant-flow.ts",
			"api/modules/scans/tools/java-source-analysis.ts",
			"api/modules/scans/tools/java-project-model.ts",
			"api/modules/scans/tools/java-taint-precision-filter.ts",
			"api/modules/scans/tools/java-flow-control.ts",
			"api/modules/scans/tools/java-helper-resolution.ts",
			"api/modules/scans/tools/java-standard-values.ts",
			"api/modules/scans/tools/java-constant-values.ts",
			"api/modules/scans/tools/java-sink-proof.ts",
			"api/modules/scans/tools/java-reflection-summary.ts",
			"api/modules/scans/tools/java-configured-hash-evaluator.ts",
			"api/modules/scans/tools/java-properties.ts",
			"bun.lock",
			"docker/toolbox/scanner-data/semgrep-rules",
		]),
		scannerVersion: raw.version,
		scannerImage: image ?? null,
		ok,
		counts: {
			positive: cases.filter((c) => c.expected).length,
			negative: cases.filter((c) => !c.expected).length,
			passed: cases.filter((c) => c.passed).length,
		},
		cases,
	};
	await mkdir(path.dirname(outputPath), { recursive: true });
	await Bun.write(outputPath, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		JSON.stringify({
			ok,
			outputPath,
			counts: report.counts,
			failures: cases.filter((c) => !c.passed),
		}),
	);
	if (!ok) process.exitCode = 1;
}
