import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseOwaspExpectedResults } from "../../api/modules/benchmarks/owasp-benchmark-adapter";
import {
	gitCommit,
	sha256File,
	sha256Tree,
} from "./benchmark-input-provenance";
import {
	analyzeOwaspFailures,
	type OwaspRawResult,
} from "./owasp-failure-analysis-lib";

const expectedPath = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
	"owasp-benchmark-java/source/expectedresults-1.2beta.csv",
);
const rawPath = path.resolve(".artifacts/benchmark/owasp-semgrep-raw.json");
const metricsPath = path.resolve(".artifacts/benchmark/owasp-metrics.json");
const [expectedBytes, rawBytes, metricsBytes] = await Promise.all([
	readFile(expectedPath),
	readFile(rawPath),
	readFile(metricsPath),
]);
const expected = parseOwaspExpectedResults(expectedBytes.toString("utf8"));
const raw = JSON.parse(rawBytes.toString("utf8")) as {
	results?: OwaspRawResult[];
};
const metrics = JSON.parse(metricsBytes.toString("utf8")) as {
	findingsHash?: string;
	rawScannerArtifactHash?: string | null;
};
const [actualRawHash, actualFindingsHash] = await Promise.all([
	sha256File(rawPath),
	sha256File(path.resolve(".artifacts/benchmark/owasp-findings.json")),
]);
if (
	metrics.rawScannerArtifactHash !== actualRawHash ||
	metrics.findingsHash !== actualFindingsHash
) {
	throw new Error("owasp_failure_analysis_input_hash_mismatch");
}
const analysis = analyzeOwaspFailures(expected, raw.results ?? []);
const report = {
	schemaVersion: 2,
	corpus: "owasp-benchmark-java-1.2beta",
	generatedAt: new Date().toISOString(),
	gitCommit: await gitCommit(),
	policyHash: await sha256File(
		"spec/security-capability/benchmark-policy.v1.json",
	),
	implementationHash: await sha256Tree([
		"docker/toolbox/scanner-data/semgrep-rules/java",
		"scripts/benchmark/owasp-benchmark.ts",
		"scripts/benchmark/owasp-failure-analysis.ts",
		"scripts/benchmark/owasp-failure-analysis-lib.ts",
	]),
	expectedResultsHash: await sha256File(expectedPath),
	rawScannerArtifactHash: actualRawHash,
	findingsHash: actualFindingsHash,
	...analysis,
	priority:
		"Reduce mapped safe false positives with paired fixtures before recall expansion; retain cross-CWE observations and do not change benchmark-policy.v1.json.",
};
const output = path.resolve(".artifacts/benchmark/owasp-failure-analysis.json");
await mkdir(path.dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({
		ok: true,
		output: path.relative(process.cwd(), output),
		falseNegativeCount: report.falseNegativeCount,
		falsePositiveCount: report.falsePositiveCount,
		mappedSafeFalsePositiveCount: report.mappedSafeFalsePositiveCount,
		unmappedCrossCweCount: report.unmappedCrossCweCount,
		falseNegativesByCategory: report.falseNegativesByCategory,
		falsePositivesByCategory: report.falsePositivesByCategory,
	})}\n`,
);
