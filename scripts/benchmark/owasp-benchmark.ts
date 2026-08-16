import crypto from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createDbConnection } from "../../api/db";
import { BenchmarkRepository } from "../../api/modules/benchmarks/benchmark-repository";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import {
	mapSemgrepFindingToObservation,
	parseOwaspExpectedResults,
} from "../../api/modules/benchmarks/owasp-benchmark-adapter";
import { canonicalJson } from "../../api/modules/scans/diff-scan-plan";
import { filterOwnedJavaTaintResults } from "../../api/modules/scans/tools/java-taint-precision-filter";
import { loadScannerDataManifest } from "../../api/modules/scans/tools/scanner-provenance";
import { benchmarkRunInputSchema } from "../../shared/schemas/benchmark.schema";
import { verifyPreparedCorpora } from "../security-corpora-lib";
import {
	gitCommit as currentGitCommit,
	sha256File as provenanceSha256File,
	sha256Tree,
} from "./benchmark-input-provenance";
import {
	buildPinnedSemgrepDockerCommand,
	containerCorpusPathToHost,
	hostCorpusPath,
	pinnedImageDigest,
	repositoryRelativeEvidencePath,
	sanitizeSemgrepEvidenceArtifact,
} from "./owasp-benchmark-runtime";
import { owaspBenchmarkInputHash } from "./owasp-benchmark-input";
import {
	assertOwaspMetricsPassReleasePolicy,
	owaspReleasePolicySchema,
} from "./owasp-release-policy";

type FindingInput = {
	path: string;
	cwe: string | number;
	category: string;
};

const corporaRoot = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
);
const expectedResultsPath = path.join(
	corporaRoot,
	"owasp-benchmark-java/source/expectedresults-1.2beta.csv",
);
const startedAt = performance.now();
const verifiedCorpora = await verifyPreparedCorpora({
	outputRoot: corporaRoot,
	ids: ["owasp-benchmark-java"],
});
const suppliedFindingsPath = process.env.VULN_WORKBENCH_OWASP_FINDINGS;
const semgrepImage = process.env.VULN_WORKBENCH_OWASP_SEMGREP_IMAGE;
const findingsPath = path.resolve(
	suppliedFindingsPath ?? ".artifacts/benchmark/owasp-findings.json",
);
const findingsEvidencePath = repositoryRelativeEvidencePath(findingsPath);
const expected = parseOwaspExpectedResults(
	await readFile(expectedResultsPath, "utf8"),
);
if (suppliedFindingsPath) {
	if (!(await stat(findingsPath).catch(() => null)))
		throw new Error("owasp_supplied_findings_missing");
} else {
	await runSemgrepBenchmark(
		findingsPath,
		path.dirname(expectedResultsPath),
		semgrepImage,
	);
}
const findings = JSON.parse(
	await readFile(findingsPath, "utf8"),
) as FindingInput[];
const observations = findings
	.map(mapSemgrepFindingToObservation)
	.filter((value) => value !== null);
const score = scoreBenchmark(expected, observations);
const outputPath = path.resolve(".artifacts/benchmark/owasp-metrics.json");
await mkdir(path.dirname(outputPath), { recursive: true });
const [
	manifest,
	expectedResultsHash,
	findingsHash,
	releaseCommit,
	policyHash,
	implementationHash,
] = await Promise.all([
	loadScannerDataManifest(),
	sha256File(expectedResultsPath),
	sha256File(findingsPath),
	currentGitCommit(),
	provenanceSha256File("spec/security-capability/benchmark-policy.v1.json"),
	sha256Tree([
		"docker/toolbox/scanner-data/semgrep-rules/java",
		"scripts/benchmark/owasp-benchmark.ts",
		"scripts/benchmark/owasp-benchmark-input.ts",
		"scripts/benchmark/owasp-benchmark-runtime.ts",
		"scripts/benchmark/owasp-release-policy.ts",
		"api/modules/benchmarks/metric-scorer.ts",
		"api/modules/benchmarks/owasp-benchmark-adapter.ts",
		"api/modules/scans/tools/java-taint-precision-filter.ts",
		"scripts/benchmark/benchmark-input-provenance.ts",
	]),
]);
const rawArtifactPath = path.resolve(
	".artifacts/benchmark/owasp-semgrep-raw.json",
);
const rawScannerArtifactHash =
	!suppliedFindingsPath && (await stat(rawArtifactPath).catch(() => null))
		? await sha256File(rawArtifactPath)
		: null;
const metricArtifact = {
	schemaVersion: 1,
	corpusId: "owasp-benchmark-java",
	gitCommit: releaseCommit,
	policyHash,
	implementationHash,
	corpusVersion: verifiedCorpora[0]?.version,
	corpusDigest: verifiedCorpora[0]?.archiveSha256,
	expectedResultsHash,
	scannerManifestHash: manifest.manifestHash,
	findingsPath: findingsEvidencePath,
	findingsHash,
	rawScannerArtifactHash,
	normalizedFindingSnapshotHash: sha256(canonicalJson(observations)),
	durationMs: Math.round(performance.now() - startedAt),
	peakMemoryKb: process.resourceUsage().maxRSS,
	requestCount: 0,
	networkRequests: 0,
	resetSucceeded: true,
	...score,
};
await Bun.write(outputPath, `${JSON.stringify(metricArtifact, null, 2)}\n`);
const benchmarkRunId = await persistBenchmarkRunIfConfigured({
	metricArtifact,
	metrics: score.metrics,
	outputHash: score.outputHash,
	manifestHash: manifest.manifestHash,
	freshScannerRun: suppliedFindingsPath === undefined,
	semgrepImage,
});

async function runSemgrepBenchmark(
	outputPath: string,
	corpusSource: string,
	semgrepImage?: string,
): Promise<void> {
	const rawPath = path.resolve(".artifacts/benchmark/owasp-semgrep-raw.json");
	await mkdir(path.dirname(rawPath), { recursive: true });
	const command = semgrepImage
		? buildPinnedSemgrepDockerCommand({
				image: semgrepImage,
				expectedImageDigest: process.env.VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST,
				repositoryRoot: process.cwd(),
				corpusSource,
				rawOutputPath: rawPath,
			})
		: [
				"semgrep",
				"scan",
				"--strict",
				"--config",
				path.resolve("docker/toolbox/scanner-data/semgrep-rules"),
				"--json",
				"--output",
				rawPath,
				"--quiet",
				"--no-git-ignore",
				corpusSource,
			];
	const child = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			SEMGREP_SEND_METRICS: "off",
			SEMGREP_ENABLE_VERSION_CHECK: "0",
		},
	});
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (![0, 1].includes(exitCode))
		throw new Error(`owasp_semgrep_failed:${exitCode}:${stderr.slice(0, 500)}`);
	const rawEnvelope = JSON.parse(await readFile(rawPath, "utf8")) as {
		results?: Array<{
			path?: string;
			extra?: { metadata?: { cwe?: string | string[] } };
		}>;
	};
	for (const result of rawEnvelope.results ?? []) {
		if (result.path) {
			result.path = semgrepImage
				? containerCorpusPathToHost(result.path, corpusSource)
				: hostCorpusPath(result.path, corpusSource);
		}
	}
	const filtered = await filterOwnedJavaTaintResults(rawEnvelope);
	const raw = sanitizeSemgrepEvidenceArtifact(filtered.output, corpusSource);
	await Bun.write(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
	const categoryByTest = new Map(
		expected.map((item) => [item.testId, item.category]),
	);
	const findings = (raw.results ?? []).flatMap((result) => {
		const testId = result.path?.match(/BenchmarkTest\d{5}/)?.[0];
		const cwes = Array.isArray(result.extra?.metadata?.cwe)
			? result.extra?.metadata?.cwe
			: result.extra?.metadata?.cwe
				? [result.extra.metadata.cwe]
				: [];
		const category = testId ? categoryByTest.get(testId) : undefined;
		if (!result.path || !category) return [];
		return cwes.map((cwe) => ({ path: result.path as string, cwe, category }));
	});
	await Bun.write(outputPath, `${JSON.stringify(findings, null, 2)}\n`);
}
console.log(
	JSON.stringify({
		ok: true,
		outputPath,
		outputHash: score.outputHash,
		benchmarkRunId,
		overall: score.metrics.find((metric) => metric.category === "overall"),
	}),
);

async function sha256File(filePath: string): Promise<string> {
	return sha256(await readFile(filePath));
}

function sha256(value: string | Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function persistBenchmarkRunIfConfigured(params: {
	metricArtifact: typeof metricArtifact;
	metrics: typeof score.metrics;
	outputHash: string;
	manifestHash: string;
	freshScannerRun: boolean;
	semgrepImage?: string;
}): Promise<string | null> {
	const databaseUrl = process.env.VULN_WORKBENCH_BENCHMARK_DATABASE_URL;
	if (!databaseUrl) return null;
	if (!params.freshScannerRun)
		throw new Error("benchmark_persistence_requires_fresh_scanner_run");
	const toolboxImageDigest = process.env.VULN_WORKBENCH_TOOLBOX_IMAGE_DIGEST;
	if (!toolboxImageDigest)
		throw new Error("benchmark_toolbox_image_digest_required");
	if (!params.semgrepImage)
		throw new Error("benchmark_persistence_requires_pinned_semgrep_image");
	if (pinnedImageDigest(params.semgrepImage) !== toolboxImageDigest)
		throw new Error("benchmark_toolbox_image_digest_mismatch");
	const policy = owaspReleasePolicySchema.parse(
		JSON.parse(
			await readFile(
				"spec/security-capability/benchmark-policy.v1.json",
				"utf8",
			),
		),
	);
	assertOwaspMetricsPassReleasePolicy(params.metrics, policy);
	const input = benchmarkRunInputSchema.parse({
		corpusId: "owasp-benchmark-java",
		corpusVersion: params.metricArtifact.corpusVersion,
		corpusDigest: params.metricArtifact.corpusDigest,
		gitCommit: await gitCommit(),
		toolboxImageDigest,
		scannerManifestHash: params.manifestHash,
		benchmarkPolicyVersion: policy.policyVersion,
		inputHash: owaspBenchmarkInputHash({
			corpusDigest: params.metricArtifact.corpusDigest,
			expectedResultsHash: params.metricArtifact.expectedResultsHash,
			findingsHash: params.metricArtifact.findingsHash,
			rawScannerArtifactHash: params.metricArtifact.rawScannerArtifactHash,
			scannerManifestHash: params.manifestHash,
		}),
	});
	const connection = createDbConnection(databaseUrl, {
		shutdownWriterOnClose: true,
	});
	const repository = new BenchmarkRepository(connection.db);
	let runId: string | null = null;
	try {
		const run = await repository.create(input);
		runId = run.id;
		await repository.start(run.id);
		await repository.complete({
			runId: run.id,
			metrics: params.metrics,
			outputHash: params.outputHash,
		});
		await Bun.write(
			path.resolve(".artifacts/benchmark/owasp-run.json"),
			`${JSON.stringify(
				{
					schemaVersion: 1,
					runId: run.id,
					gitCommit: input.gitCommit,
					inputHash: input.inputHash,
					outputHash: params.outputHash,
				},
				null,
				2,
			)}\n`,
		);
		return run.id;
	} catch (error) {
		if (runId)
			await repository
				.fail(
					runId,
					error instanceof Error
						? error.message
						: "benchmark_persistence_failed",
				)
				.catch(() => undefined);
		throw error;
	} finally {
		connection.sqlite.close();
	}
}

async function gitCommit(): Promise<string> {
	const child = Bun.spawn(["git", "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if ((await child.exited) !== 0) throw new Error("git_commit_unavailable");
	return (await new Response(child.stdout).text()).trim();
}
