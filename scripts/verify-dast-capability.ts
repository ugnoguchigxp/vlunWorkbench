import { readFile } from "node:fs/promises";
import {
	currentDastStandardHashes,
	type DastStandardBenchmarkReport,
} from "./benchmark/dast-standard-lib";

const artifactPath = ".artifacts/benchmark/dast-standard-metrics.json";
const report = JSON.parse(
	await readFile(artifactPath, "utf8"),
) as DastStandardBenchmarkReport;
if (
	report.schemaVersion !== 1 ||
	report.benchmarkId !== "owned-dast-standard-v1"
) {
	throw new Error("dast_standard_artifact_schema_invalid");
}
const currentHashes = await currentDastStandardHashes();
if (JSON.stringify(report.hashes) !== JSON.stringify(currentHashes)) {
	throw new Error("dast_standard_artifact_hash_mismatch");
}
if (!report.gatePassed || !Object.values(report.gates).every(Boolean)) {
	throw new Error("dast_standard_capability_gate_failed");
}
const commit = Bun.spawn(["git", "rev-parse", "HEAD"], {
	stdout: "pipe",
	stderr: "pipe",
});
if ((await commit.exited) !== 0) throw new Error("git_commit_unavailable");
const currentCommit = (await new Response(commit.stdout).text()).trim();
if (report.gitCommit !== currentCommit) {
	throw new Error("dast_standard_artifact_commit_mismatch");
}
console.log(
	JSON.stringify({
		ok: true,
		benchmarkId: report.benchmarkId,
		gitCommit: report.gitCommit,
		hashes: report.hashes,
	}),
);
