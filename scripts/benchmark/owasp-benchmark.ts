import crypto from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	mapSemgrepFindingToObservation,
	parseOwaspExpectedResults,
} from "../../api/modules/benchmarks/owasp-benchmark-adapter";
import { scoreBenchmark } from "../../api/modules/benchmarks/metric-scorer";
import { canonicalJson } from "../../api/modules/scans/diff-scan-plan";
import { loadScannerDataManifest } from "../../api/modules/scans/tools/scanner-provenance";
import { verifyPreparedCorpora } from "../security-corpora-lib";

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
const findingsPath = path.resolve(
	suppliedFindingsPath ?? ".artifacts/benchmark/owasp-findings.json",
);
const expected = parseOwaspExpectedResults(
	await readFile(expectedResultsPath, "utf8"),
);
if (suppliedFindingsPath) {
	if (!(await stat(findingsPath).catch(() => null)))
		throw new Error("owasp_supplied_findings_missing");
} else {
	await runSemgrepBenchmark(findingsPath, path.dirname(expectedResultsPath));
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
const [manifest, expectedResultsHash, findingsHash] = await Promise.all([
	loadScannerDataManifest(),
	sha256File(expectedResultsPath),
	sha256File(findingsPath),
]);
const rawArtifactPath = path.resolve(
	".artifacts/benchmark/owasp-semgrep-raw.json",
);
const rawScannerArtifactHash =
	!suppliedFindingsPath && (await stat(rawArtifactPath).catch(() => null))
		? await sha256File(rawArtifactPath)
		: null;
await Bun.write(
	outputPath,
	`${JSON.stringify(
		{
			schemaVersion: 1,
			corpusId: "owasp-benchmark-java",
			corpusVersion: verifiedCorpora[0]?.version,
			corpusDigest: verifiedCorpora[0]?.archiveSha256,
			expectedResultsHash,
			scannerManifestHash: manifest.manifestHash,
			findingsPath,
			findingsHash,
			rawScannerArtifactHash,
			normalizedFindingSnapshotHash: sha256(canonicalJson(observations)),
			durationMs: Math.round(performance.now() - startedAt),
			peakMemoryKb: process.resourceUsage().maxRSS,
			requestCount: 0,
			networkRequests: 0,
			resetSucceeded: true,
			...score,
		},
		null,
		2,
	)}\n`,
);

async function runSemgrepBenchmark(
	outputPath: string,
	corpusSource: string,
): Promise<void> {
	const rawPath = path.resolve(".artifacts/benchmark/owasp-semgrep-raw.json");
	await mkdir(path.dirname(rawPath), { recursive: true });
	const child = Bun.spawn(
		[
			"semgrep",
			"scan",
			"--config",
			path.resolve("docker/toolbox/scanner-data/semgrep-rules"),
			"--json",
			"--output",
			rawPath,
			"--quiet",
			"--no-git-ignore",
			corpusSource,
		],
		{
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				SEMGREP_SEND_METRICS: "off",
				SEMGREP_ENABLE_VERSION_CHECK: "0",
			},
		},
	);
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (![0, 1].includes(exitCode))
		throw new Error(`owasp_semgrep_failed:${exitCode}:${stderr.slice(0, 500)}`);
	const raw = JSON.parse(await readFile(rawPath, "utf8")) as {
		results?: Array<{
			path?: string;
			extra?: { metadata?: { cwe?: string | string[] } };
		}>;
	};
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
		overall: score.metrics.find((metric) => metric.category === "overall"),
	}),
);

async function sha256File(filePath: string): Promise<string> {
	return sha256(await readFile(filePath));
}

function sha256(value: string | Uint8Array): string {
	return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}
