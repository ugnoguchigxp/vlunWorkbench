import { readFile } from "node:fs/promises";
import { z } from "zod";
import { phase54BaselineEvidenceSchema } from "../shared/schemas/release-evidence.schema";
import { assertEvidencePrivacy, sha256 } from "./phase-54-baseline-lib";

const baselinePath = "spec/evidence/phase-54-baseline.json";
const inputPaths = {
	benchmarkPolicy: "spec/security-capability/benchmark-policy.v1.json",
	scannerDataManifestFile:
		"docker/toolbox/scanner-data/scanner-data-manifest.json",
	externalBenchmark: "spec/evidence/phase-50-external-benchmark.json",
	phase50ReleaseReport: "spec/evidence/phase-50-release-report.json",
	phase53Baseline: "spec/evidence/phase-53-python-go-baseline.json",
} as const;

const externalBenchmarkSchema = z.object({
	owaspBenchmark: z.object({
		metrics: z.object({
			recall: z.number(),
			precision: z.number(),
			falsePositiveRate: z.number(),
			score: z.number(),
		}),
	}),
	juiceShop: z.object({
		eligibleScenarioCount: z.number().int(),
		categoryCount: z.number().int(),
		executedScenarioCount: z.number().int(),
		metrics: z.object({
			recall: z.number().nullable(),
			precision: z.number().nullable(),
			falsePositiveRate: z.number().nullable(),
			score: z.number().nullable(),
		}),
	}),
});

const baselineText = await readFile(baselinePath, "utf8");
assertEvidencePrivacy(baselineText);
const baseline = phase54BaselineEvidenceSchema.parse(
	JSON.parse(baselineText) as unknown,
);
if (baseline.snapshotKind !== "planning_baseline") {
	throw new Error("phase_54_committed_baseline_must_be_planning_baseline");
}

await assertAncestor(baseline.planningBaselineCommit);
for (const [hashKey, inputPath] of Object.entries(inputPaths) as Array<
	[keyof typeof inputPaths, string]
>) {
	const historicalBytes = await gitBlob(
		baseline.planningBaselineCommit,
		inputPath,
	);
	if (baseline.hashes[hashKey] !== sha256(historicalBytes)) {
		throw new Error(`phase_54_baseline_hash_mismatch:${hashKey}`);
	}
}

const externalBenchmark = externalBenchmarkSchema.parse(
	JSON.parse(
		new TextDecoder().decode(
			await gitBlob(
				baseline.planningBaselineCommit,
				inputPaths.externalBenchmark,
			),
		),
	),
);
if (
	JSON.stringify(baseline.metrics.owaspBenchmark) !==
		JSON.stringify(externalBenchmark.owaspBenchmark.metrics) ||
	baseline.metrics.juiceShop.eligibleScenarios !==
		externalBenchmark.juiceShop.eligibleScenarioCount ||
	baseline.metrics.juiceShop.categories !==
		externalBenchmark.juiceShop.categoryCount ||
	baseline.metrics.juiceShop.executedScenarios !==
		externalBenchmark.juiceShop.executedScenarioCount ||
	baseline.metrics.juiceShop.recall !==
		externalBenchmark.juiceShop.metrics.recall ||
	baseline.metrics.juiceShop.precision !==
		externalBenchmark.juiceShop.metrics.precision ||
	baseline.metrics.juiceShop.falsePositiveRate !==
		externalBenchmark.juiceShop.metrics.falsePositiveRate ||
	baseline.metrics.juiceShop.score !== externalBenchmark.juiceShop.metrics.score
) {
	throw new Error("phase_54_baseline_metric_mismatch");
}

const requiredGateIds = [
	"format",
	"phase-50-historical-evidence",
	"phase-53-capability",
	"github-linux-strict",
	"capability-documentation",
	"professional-capability",
	"toolbox-offline",
	"python-project-execution-sandbox",
	"go-dast-auto-start",
];
const baselineGateIds = new Set(baseline.gates.map((gate) => gate.id));
if (requiredGateIds.some((gateId) => !baselineGateIds.has(gateId))) {
	throw new Error("phase_54_baseline_required_gate_missing");
}

const trackedFiles = (
	await gitOutput([
		"ls-tree",
		"-r",
		"--name-only",
		baseline.planningBaselineCommit,
	])
)
	.split("\n")
	.filter(Boolean);
// Schema v1 records the inventory behavior that existed at the planning commit.
// Keep this historical rule local: current discovery intentionally no longer
// excludes source directories merely because a nested directory is named artifacts.
const legacyIgnoredTestDirectoryNames = new Set([
	".git",
	".artifacts",
	".cache",
	".tmp",
	"artifacts",
	"build",
	"coverage",
	"data",
	"dist",
	"dist-web",
	"node_modules",
	"playwright-report",
	"test-results",
]);
const testFileCount = trackedFiles.filter(
	(file) =>
		/\.test\.(?:ts|tsx)$/.test(file) &&
		!file.split("/").some((part) => legacyIgnoredTestDirectoryNames.has(part)),
).length;
if (testFileCount !== baseline.inventory.testFiles) {
	throw new Error("phase_54_baseline_test_inventory_mismatch");
}

console.log(
	JSON.stringify({
		ok: true,
		phase: baseline.phase,
		baselineCommit: baseline.planningBaselineCommit,
		gateStates: Object.fromEntries(
			baseline.gates.map((gate) => [gate.id, gate.state]),
		),
		inputHashesVerifiedAtBaselineCommit: Object.keys(inputPaths).length,
	}),
);

async function assertAncestor(commit: string): Promise<void> {
	const child = Bun.spawn(
		["git", "merge-base", "--is-ancestor", commit, "HEAD"],
		{
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	if ((await child.exited) !== 0) {
		throw new Error("phase_54_baseline_commit_is_not_ancestor");
	}
}

async function gitBlob(commit: string, file: string): Promise<Uint8Array> {
	const child = Bun.spawn(["git", "show", `${commit}:${file}`], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).arrayBuffer(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(
			`phase_54_historical_input_missing:${file}:${stderr.trim()}`,
		);
	}
	return new Uint8Array(stdout);
}

async function gitOutput(args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(`phase_54_git_command_failed:${stderr.trim()}`);
	}
	return stdout.trim();
}
