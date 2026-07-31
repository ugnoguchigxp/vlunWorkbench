import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const targets = new Map<string, number>([
	["api/middleware/auth.ts", 95],
	["api/middleware/rate-limiter.ts", 75],
	["api/security/outbound-url-policy.ts", 95],
	["api/security/project-path-policy.ts", 95],
	["api/security/secret-crypto.ts", 95],
	["api/modules/dast/active-assessment-runner.ts", 90],
	["api/modules/dynamic/dynamic-artifact-storage.ts", 75],
	["api/modules/dynamic/dynamic-docker-executor.ts", 85],
	["api/modules/dynamic/dynamic-profiles.ts", 90],
	["api/modules/dynamic/dynamic-runner.ts", 95],
	[
		"api/modules/integrations/nightworkers/nightworkers-integration.service.ts",
		85,
	],
	["api/modules/scans/scan-diagnostic-runner.ts", 80],
	["api/modules/scans/tools/tool-process-runner.ts", 80],
]);
const tests = [
	"api/middleware/auth.test.ts",
	"api/middleware/rate-limiter.test.ts",
	"api/security/outbound-url-policy.test.ts",
	"api/security/project-path-policy.test.ts",
	"api/security/secret-crypto.test.ts",
	"api/modules/dast/active-assessment-runner.test.ts",
	"api/modules/dynamic/dynamic-artifact-storage.test.ts",
	"api/modules/dynamic/dynamic-profiles.test.ts",
	"api/modules/dynamic/dynamic-runner.test.ts",
	"api/modules/integrations/nightworkers/nightworkers-integration.service.test.ts",
	"api/modules/scans/scan-diagnostic-runner.test.ts",
	"api/modules/scans/tools/tool-process-runner.test.ts",
];

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
			...tests,
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
	for (const [target, minimum] of targets) {
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
		`${JSON.stringify({ ok: failed.length === 0, results })}\n`,
	);
	if (failed.length > 0) process.exitCode = 1;
} finally {
	await rm(coverageDirectory, { recursive: true, force: true });
}
