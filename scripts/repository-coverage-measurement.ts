import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	classifyProductionFiles,
	discoverProductionFiles,
	loadCoverageScopePolicy,
} from "./coverage-scope-inventory-lib";
import {
	bunTestTimeoutMs,
	discoverTestFiles,
	isVitestFile,
} from "./test-files";

type LineCoverage = { hit: number; total: number };

function parseLcov(input: string, root: string): Map<string, LineCoverage> {
	const result = new Map<string, LineCoverage>();
	for (const record of input.split("end_of_record")) {
		const source = /^SF:(.+)$/m.exec(record)?.[1];
		if (!source) continue;
		const relative = path
			.relative(
				root,
				path.isAbsolute(source) ? source : path.join(root, source),
			)
			.split(path.sep)
			.join("/");
		const lines = [...record.matchAll(/^DA:\d+,(\d+)/gm)].map((match) =>
			Number(match[1]),
		);
		if (lines.length === 0) continue;
		const previous = result.get(relative) ?? { hit: 0, total: 0 };
		result.set(relative, {
			hit: Math.max(previous.hit, lines.filter((count) => count > 0).length),
			total: Math.max(previous.total, lines.length),
		});
	}
	return result;
}

async function run(
	command: string[],
	env?: Record<string, string>,
): Promise<void> {
	const child = Bun.spawn(command, {
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env, ...env },
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(
			`Coverage command failed (${exitCode}): ${command.join(" ")}`,
		);
	}
}

async function collectBunCoverage(
	tests: readonly string[],
	directory: string,
): Promise<Map<string, LineCoverage>> {
	let nextIndex = 0;
	const failures: string[] = [];
	const coverage = new Map<string, LineCoverage>();
	const workers = Array.from(
		{ length: Math.min(4, tests.length) },
		async () => {
			while (true) {
				const index = nextIndex++;
				const test = tests[index];
				if (!test) return;
				const timeoutMs = bunTestTimeoutMs(test);
				const testDirectory = path.join(directory, String(index));
				await mkdir(testDirectory, { recursive: true });
				const child = Bun.spawn(
					[
						"bun",
						"test",
						"--no-orphans",
						"--preload",
						"./scripts/bun-test-lifecycle.ts",
						...(timeoutMs ? [`--timeout=${timeoutMs}`] : []),
						"--coverage",
						"--coverage-reporter=lcov",
						`--coverage-dir=${testDirectory}`,
						test,
					],
					{
						stdout: "pipe",
						stderr: "pipe",
						env: { ...process.env, NODE_ENV: "test" },
					},
				);
				const [exitCode, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				if (exitCode !== 0) {
					failures.push(test);
					process.stderr.write(`${stdout}${stderr}`);
					continue;
				}
				const fileCoverage = parseLcov(
					await readFile(path.join(testDirectory, "lcov.info"), "utf8"),
					process.cwd(),
				);
				for (const [file, measurement] of fileCoverage) {
					const previous = coverage.get(file);
					coverage.set(file, {
						hit: Math.max(previous?.hit ?? 0, measurement.hit),
						total: Math.max(previous?.total ?? 0, measurement.total),
					});
				}
			}
		},
	);
	await Promise.all(workers);
	if (failures.length > 0) {
		throw new Error(`Bun coverage tests failed: ${failures.join(", ")}`);
	}
	return coverage;
}

const root = process.cwd();
const temporary = await mkdtemp(
	path.join(os.tmpdir(), "vuln-workbench-repository-coverage-"),
);
const bunDirectory = path.join(temporary, "bun");
const vitestDirectory = path.join(temporary, "vitest");
const outputArgument = process.argv
	.slice(2)
	.find((value) => value.startsWith("--output="));
const output = path.resolve(
	root,
	outputArgument?.slice("--output=".length) ??
		".artifacts/coverage/repository-measurement.json",
);

try {
	const tests = await discoverTestFiles(root);
	const bunTests = tests.filter((file) => !isVitestFile(file));
	await mkdir(bunDirectory, { recursive: true });
	const coverage = await collectBunCoverage(bunTests, bunDirectory);
	await run([
		"bunx",
		"vitest",
		"run",
		"--config",
		"vitest.repository-coverage.config.ts",
		"--coverage",
		`--coverage.reportsDirectory=${vitestDirectory}`,
	]);

	for (const [file, measurement] of parseLcov(
		await readFile(path.join(vitestDirectory, "lcov.info"), "utf8"),
		root,
	)) {
		const previous = coverage.get(file);
		coverage.set(file, {
			hit: Math.max(previous?.hit ?? 0, measurement.hit),
			total: Math.max(previous?.total ?? 0, measurement.total),
		});
	}

	const productionFiles = await discoverProductionFiles(root);
	const policy = await loadCoverageScopePolicy(root);
	const classifications = new Map(
		classifyProductionFiles(productionFiles, policy).map((entry) => [
			entry.path,
			entry.classification,
		]),
	);
	const files = productionFiles.map((file) => ({
		path: file,
		classification: classifications.get(file),
		measured: coverage.has(file),
		lines: coverage.get(file) ?? null,
	}));
	const measured = files.filter((file) => file.measured);
	const hit = measured.reduce((sum, file) => sum + (file.lines?.hit ?? 0), 0);
	const total = measured.reduce(
		(sum, file) => sum + (file.lines?.total ?? 0),
		0,
	);
	const report = {
		scopeKind: "repository_measurement",
		measurementOnly: true,
		generatedAt: new Date().toISOString(),
		productionFiles: files.length,
		measuredFiles: measured.length,
		unmeasuredFiles: files.length - measured.length,
		observedLineCoverage: {
			hit,
			total,
			percent: total === 0 ? 0 : (hit / total) * 100,
		},
		warning:
			"Observed line coverage is not repository-wide release coverage; uninstrumented files remain explicit.",
		files,
	};
	await mkdir(path.dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	process.stdout.write(
		`${JSON.stringify({ ...report, files: undefined, output: path.relative(root, output) })}\n`,
	);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
