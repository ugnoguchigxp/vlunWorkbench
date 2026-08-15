import { readFile } from "node:fs/promises";
import { loadScannerDataManifest } from "../api/modules/scans/tools/scanner-provenance";
import {
	assertMetricArtifactIntegrity,
	isAuthoritativeJuiceShopReleaseRun,
	readMetricArtifact,
	verifyJuiceShopArtifactIntegrity,
} from "./professional-capability-artifact-verifier";

const metricsPath = ".artifacts/benchmark/juice-shop-metrics.json";
const artifact = await readMetricArtifact(metricsPath);
if (!artifact) throw new Error("juice_shop_metrics_missing");
assertMetricArtifactIntegrity(artifact);
const [manifest, corpusLock, releaseCommit, workingTreeClean] =
	await Promise.all([
		loadScannerDataManifest(),
		readJson("spec/security-capability/corpora.lock.json"),
		gitCommit(),
		gitWorkingTreeClean(),
	]);
const report = await verifyJuiceShopArtifactIntegrity({
	artifact,
	manifestHash: manifest.manifestHash,
	corpusLock,
});
if (
	!isAuthoritativeJuiceShopReleaseRun({
		report,
		releaseCommit,
		workingTreeClean,
	})
)
	throw new Error("juice_shop_release_evidence_not_authoritative");
console.log(
	JSON.stringify({
		ok: true,
		releaseCommit,
		measurementStatus: report.measurementStatus,
		counts: report.counts,
	}),
);

async function readJson(filePath: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(filePath, "utf8")) as Record<
		string,
		unknown
	>;
}

async function gitCommit(): Promise<string> {
	return await runGit(["rev-parse", "HEAD"]);
}

async function gitWorkingTreeClean(): Promise<boolean> {
	return (
		(await runGit(["status", "--porcelain", "--untracked-files=all"])) === ""
	);
}

async function runGit(args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
	]);
	if (exitCode !== 0) throw new Error("git_evidence_unavailable");
	return stdout.trim();
}
