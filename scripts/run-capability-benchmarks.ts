import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import { gitCommit, sha256File } from "./benchmark/benchmark-input-provenance";
import { pinnedImageDigest } from "./benchmark/owasp-benchmark-runtime";

// Run in a dedicated clean checkout. No saved findings or caller-supplied run
// receipt may be promoted: this command produces and verifies its own run.
if (process.platform !== "linux")
	throw new Error("capability_benchmarks_require_linux");
if (process.env.VULN_WORKBENCH_OWASP_FINDINGS)
	throw new Error("capability_benchmarks_require_fresh_scan");
const releaseCommit = await gitCommit();
const sourceTree = await git(["rev-parse", "HEAD^{tree}"]);
await assertClean();
const semgrepImage = process.env.VULN_WORKBENCH_OWASP_SEMGREP_IMAGE;
const osvImage = process.env.VULN_WORKBENCH_OSV_FIXTURE_IMAGE;
const databaseRoot = process.env.VULN_WORKBENCH_OSV_FIXTURE_DB;
if (!semgrepImage || !osvImage || !databaseRoot)
	throw new Error(
		"capability_benchmarks_pinned_images_and_offline_database_required",
	);
const semgrepDigest = pinnedImageDigest(semgrepImage);
pinnedImageDigest(osvImage);
const manifest = await loadScannerDataManifest();
if (manifest.tools.osv?.state !== "ready")
	throw new Error("capability_benchmarks_offline_database_not_ready");
const runRoot = path.resolve(".artifacts/capability", crypto.randomUUID());
await mkdir(runRoot, { recursive: true });
const databasePath = path.join(runRoot, "benchmark.sqlite");
const env: NodeJS.ProcessEnv = {
	...process.env,
	DATABASE_URL: `file:${databasePath}`,
	VULN_WORKBENCH_BENCHMARK_DATABASE_URL: `file:${databasePath}`,
	VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST: semgrepDigest,
};
delete env.VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID;
const commands: Array<{ command: string; exitCode: number }> = [];
let failure: string | null = null;
let benchmarkRunId: string | null = null;
try {
	await run(["bun", "run", "db:migrate"]);
	await run(["bun", "run", "security-corpora:verify"]);
	await run(["bun", "run", "benchmark:all"]);
	const receipt = JSON.parse(
		await readFile(".artifacts/benchmark/owasp-run.json", "utf8"),
	) as { runId: string; gitCommit: string };
	if (
		receipt.gitCommit !== releaseCommit ||
		!/^[a-f0-9-]{36}$/.test(receipt.runId)
	)
		throw new Error("capability_benchmarks_receipt_invalid");
	benchmarkRunId = receipt.runId;
	await run(["bun", "run", "verify:professional-capability"], {
		VULN_WORKBENCH_PASSING_BENCHMARK_RUN_ID: benchmarkRunId,
	});
	await run(["bun", "run", "verify:juice-shop-release"]);
	await assertClean();
	if (
		(await gitCommit()) !== releaseCommit ||
		(await git(["rev-parse", "HEAD^{tree}"])) !== sourceTree
	)
		throw new Error("capability_benchmarks_source_changed");
} catch (error) {
	failure =
		error instanceof Error ? error.message : "capability_benchmarks_failed";
}
const artifactPaths = [
	".artifacts/benchmark/all.json",
	".artifacts/benchmark/owasp-run.json",
	".artifacts/benchmark/owasp-metrics.json",
	".artifacts/benchmark/owasp-findings.json",
	".artifacts/benchmark/owasp-semgrep-raw.json",
	".artifacts/benchmark/juice-shop-run.json",
	".artifacts/benchmark/juice-shop-metrics.json",
	".artifacts/benchmark/juice-shop-observations.json",
	".artifacts/benchmark/semgrep-catalog.json",
	".artifacts/benchmark/osv-offline-fixtures.json",
	".artifacts/benchmark/business-logic-metrics.json",
	".artifacts/benchmark/endpoint-discovery-metrics.json",
	".artifacts/benchmark/dast-standard-metrics.json",
	".artifacts/professional-capability-release-report.json",
];
const artifacts: Record<string, string> = {};
for (const file of artifactPaths) {
	try {
		const archived = path.join(runRoot, path.relative(".artifacts", file));
		await mkdir(path.dirname(archived), { recursive: true });
		await cp(file, archived);
		artifacts[path.relative(runRoot, archived)] = await sha256File(archived);
	} catch {
		failure ??= `capability_benchmarks_artifact_missing:${file}`;
	}
}
await cp(
	".artifacts/benchmark/juice-shop-evidence",
	path.join(runRoot, "benchmark/juice-shop-evidence"),
	{ recursive: true },
).catch(() => {
	failure ??= "capability_benchmarks_juice_evidence_missing";
});
const report = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	releaseCommit,
	sourceTree,
	platform: process.platform,
	architecture: process.arch,
	status: failure ? "failed" : "passed",
	benchmarkRunId,
	scannerManifestHash: manifest.manifestHash,
	semgrepImage,
	osvImage,
	commands,
	artifacts,
	databasePath: path.relative(process.cwd(), databasePath),
	databaseHash: await sha256File(databasePath).catch(() => null),
	failure,
	scope:
		"Versioned owned fixtures, pinned OWASP Java and Juice Shop corpora; no claim of universal vulnerability detection.",
};
const reportPath = path.join(runRoot, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
	flag: "wx",
});
console.log(
	JSON.stringify({
		ok: failure === null,
		reportPath,
		releaseCommit,
		benchmarkRunId,
		failure,
	}),
);
if (failure) process.exitCode = 1;

async function run(command: string[], extra: Record<string, string> = {}) {
	const child = Bun.spawn(command, {
		env: { ...env, ...extra },
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await child.exited;
	commands.push({ command: command.join(" "), exitCode });
	if (exitCode !== 0)
		throw new Error(
			`capability_benchmarks_command_failed:${command.join(" ")}:${exitCode}`,
		);
}
async function assertClean() {
	if (await git(["status", "--porcelain", "--untracked-files=all"]))
		throw new Error("capability_benchmarks_require_clean_checkout");
}
async function git(args: string[]) {
	const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
	const [code, output] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	if (code !== 0) throw new Error("capability_benchmarks_git_unavailable");
	return output.trim();
}
