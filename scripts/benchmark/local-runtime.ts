import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createLocalRuntimeDatabaseFixture } from "../../api/db/testing/connection";
import {
	classifyGitSourceState,
	median,
	medianSummary,
	summarizeObservation,
	type WorkloadSummary,
} from "./local-runtime-lib";
import { runLocalRuntimeWorkloads } from "./local-runtime-workloads";

const workloadPolicySchema = z.object({ maximumP95Ms: z.number().positive() });
const policySchema = z.object({
	schemaVersion: z.literal(1),
	supportBoundary: z.string().min(1),
	minimumRepeat: z.number().int().min(3),
	maximumRssBytes: z.number().int().positive(),
	maximumQueueDepth: z.number().int().positive(),
	regression: z.object({
		maximumP95IncreasePercent: z.number().nonnegative(),
		maximumRssIncreasePercent: z.number().nonnegative(),
	}),
	approvedBaseline: z
		.object({
			hostClass: z.string(),
			rssBytes: z.number().positive(),
			p95Ms: z.record(z.string(), z.number().nonnegative()),
		})
		.optional(),
	workloads: z.record(z.string(), workloadPolicySchema),
});

function numberArgument(name: string, fallback: number): number {
	const prefix = `--${name}=`;
	const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
	return value ? Number.parseInt(value.slice(prefix.length), 10) : fallback;
}

async function gitOutput(
	args: string[],
): Promise<{ exitCode: number; output: string }> {
	const processResult = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const [exitCode, output] = await Promise.all([
		processResult.exited,
		new Response(processResult.stdout).text(),
	]);
	return { exitCode, output: output.trim() };
}

const policy = policySchema.parse(
	JSON.parse(
		await readFile("scripts/benchmark/local-runtime-policy.v1.json", "utf8"),
	),
);
const repeat = numberArgument("repeat", 3);
const samples = numberArgument("samples", 25);
if (repeat < policy.minimumRepeat) {
	throw new Error(`repeat must be at least ${policy.minimumRepeat}.`);
}
if (!Number.isFinite(samples) || samples < 5) {
	throw new Error("samples must be at least 5.");
}

const memoryBucketGiB = Math.max(1, Math.round(os.totalmem() / 1024 ** 3));
const hostClass = `${process.platform}-${process.arch}-${os.cpus().length}cpu-${memoryBucketGiB}gib`;
const fixtureContract = {
	version: 1,
	findingRows: 10_000,
	intelligenceGenerations: 100,
	writerConcurrency: [1, 4, 16, 64],
	diagnosticProvider: "fixture",
};
const fixtureHash = createHash("sha256")
	.update(JSON.stringify(fixtureContract))
	.digest("hex");
const sqliteFixture = createLocalRuntimeDatabaseFixture();
const sqliteVersion = sqliteFixture.sqliteVersion;
sqliteFixture.close();
const commitResult = await gitOutput(["rev-parse", "HEAD"]);
const commit = commitResult.exitCode === 0 ? commitResult.output : "unknown";
const statusResult = await gitOutput(["status", "--porcelain"]);
const sourceState = classifyGitSourceState(
	statusResult.exitCode,
	statusResult.output,
);

const runSummaries: WorkloadSummary[][] = [];
const rssByRun: number[] = [];
for (let index = 0; index < repeat; index += 1) {
	const observations = await runLocalRuntimeWorkloads(samples);
	runSummaries.push(observations.map(summarizeObservation));
	rssByRun.push(process.memoryUsage.rss());
}
const workloadIds = Object.keys(policy.workloads);
const workloads = workloadIds.map((id) =>
	medianSummary(
		id,
		runSummaries.map((run) => {
			const summary = run.find((candidate) => candidate.id === id);
			if (!summary) throw new Error(`Missing workload result: ${id}`);
			return summary;
		}),
	),
);
const medianRssBytes = median(rssByRun);
const errors: string[] = [];
for (const workload of workloads) {
	const workloadPolicy = policy.workloads[workload.id];
	if (!workloadPolicy) {
		errors.push(`Workload is not in policy: ${workload.id}`);
		continue;
	}
	if (workload.p95Ms > workloadPolicy.maximumP95Ms) {
		errors.push(
			`${workload.id} p95 ${workload.p95Ms.toFixed(2)}ms exceeds ${workloadPolicy.maximumP95Ms}ms.`,
		);
	}
	if (workload.errors !== 0 || workload.rejections !== 0) {
		errors.push(
			`${workload.id} has ${workload.errors} errors and ${workload.rejections} rejections.`,
		);
	}
	if (workload.maxQueueDepth > policy.maximumQueueDepth) {
		errors.push(
			`${workload.id} reached queue depth ${workload.maxQueueDepth}.`,
		);
	}
}
if (medianRssBytes > policy.maximumRssBytes) {
	errors.push(`RSS ${medianRssBytes} exceeds ${policy.maximumRssBytes}.`);
}

const baselineComparable = policy.approvedBaseline?.hostClass === hostClass;
if (baselineComparable && policy.approvedBaseline) {
	for (const workload of workloads) {
		const baseline = policy.approvedBaseline.p95Ms[workload.id];
		if (baseline === undefined) {
			errors.push(`Approved baseline is missing ${workload.id}.`);
			continue;
		}
		const maximum =
			baseline * (1 + policy.regression.maximumP95IncreasePercent / 100);
		if (workload.p95Ms > maximum) {
			errors.push(
				`${workload.id} regressed more than ${policy.regression.maximumP95IncreasePercent}%.`,
			);
		}
	}
	const maximumRss =
		policy.approvedBaseline.rssBytes *
		(1 + policy.regression.maximumRssIncreasePercent / 100);
	if (medianRssBytes > maximumRss) {
		errors.push(
			`RSS regressed more than ${policy.regression.maximumRssIncreasePercent}%.`,
		);
	}
}

const report = {
	schemaVersion: 1,
	scope: "local_runtime_single_node",
	ok: errors.length === 0,
	metadata: {
		hostClass,
		platform: process.platform,
		architecture: process.arch,
		osRelease: os.release(),
		cpuModel: os.cpus()[0]?.model ?? "unknown",
		cpuCount: os.cpus().length,
		memoryBytes: os.totalmem(),
		bunVersion: Bun.version,
		sqliteVersion,
		commit,
		sourceState,
		fixtureHash,
	},
	policy: {
		schemaVersion: policy.schemaVersion,
		supportBoundary: policy.supportBoundary,
		baselineComparable,
	},
	repeat,
	samples,
	medianRssBytes,
	workloads,
	errors,
};
const output = path.resolve(".artifacts/benchmark/local-runtime.json");
await mkdir(path.dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({ ...report, output: path.relative(process.cwd(), output) })}\n`,
);
if (!report.ok) process.exitCode = 1;
