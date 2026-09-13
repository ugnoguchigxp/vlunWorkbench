import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runBoundedProcess } from "../api/modules/processes/bounded-process-runner";
import { filterOwnedJavaTaintResults } from "../api/modules/scans/tools/java-taint-precision-filter";
import {
	gitCommit,
	sha256,
	sha256Tree,
} from "./benchmark/benchmark-input-provenance";

const manifest = JSON.parse(
	await readFile(
		"spec/security-capability/java-external-holdout.v1.json",
		"utf8",
	),
) as {
	revision: string;
	minimumRecall: number;
	minimumPrecision: number;
	files: { name: string; url: string; sha256: string }[];
	cases: {
		id: string;
		file: string;
		line: number;
		expected: boolean;
		reason: string;
	}[];
};
const root = path.resolve(".cache/java-external-holdout");
await mkdir(root, { recursive: true });
for (const file of manifest.files) {
	const target = path.join(root, file.name);
	if (path.dirname(target) !== root)
		throw new Error("holdout_file_path_invalid");
	let bytes = await readFile(target).catch(() => null);
	if (!bytes && process.argv.includes("--prepare")) {
		const response = await fetch(file.url, {
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok)
			throw new Error(`holdout_download_failed:${response.status}`);
		bytes = Buffer.from(await response.arrayBuffer());
	}
	if (!bytes || sha256(bytes) !== `sha256:${file.sha256}`)
		throw new Error(`holdout_missing_or_hash_mismatch:${file.name}`);
	await writeFile(target, bytes);
}
const started = performance.now();
const result = await runBoundedProcess({
	argv: [
		"semgrep",
		"scan",
		"--strict",
		"--config",
		"docker/toolbox/scanner-data/semgrep-rules",
		"--json",
		"--quiet",
		"--no-git-ignore",
		...manifest.files.map((file) => path.join(root, file.name)),
	],
	env: {
		...process.env,
		SEMGREP_SEND_METRICS: "off",
		SEMGREP_ENABLE_VERSION_CHECK: "0",
	},
	timeoutMs: 120_000,
	outputLimitBytes: 16 * 1024 * 1024,
});
if (result.exitCode !== 0 && result.exitCode !== 1)
	throw new Error("holdout_scanner_failed");
const raw = JSON.parse(result.stdout);
if (!Array.isArray(raw.results) || raw.errors?.length)
	throw new Error("holdout_scanner_incomplete");
const filtered = await filterOwnedJavaTaintResults(raw, { projectRoot: root });
const observations = (
	filtered.output as {
		results: Array<{
			path: string;
			start: { line: number };
			end: { line: number };
		}>;
	}
).results;
const cases = manifest.cases.map((test) => ({
	...test,
	detected: observations.some(
		(finding: {
			path: string;
			start: { line: number };
			end: { line: number };
		}) =>
			path.basename(finding.path) === test.file &&
			finding.start.line <= test.line &&
			finding.end.line >= test.line,
	),
}));
const tp = cases.filter((test) => test.expected && test.detected).length;
const fp = cases.filter((test) => !test.expected && test.detected).length;
const fn = cases.filter((test) => test.expected && !test.detected).length;
const tn = cases.filter((test) => !test.expected && !test.detected).length;
const recall = tp + fn ? tp / (tp + fn) : null;
const precision = tp + fp ? tp / (tp + fp) : null;
const report = {
	schemaVersion: 1,
	status: "measured",
	generatedAt: new Date().toISOString(),
	gitCommit: await gitCommit(),
	corpusRevision: manifest.revision,
	manifestHash: sha256(
		await readFile("spec/security-capability/java-external-holdout.v1.json"),
	),
	implementationHash: await sha256Tree([
		"api/modules/scans/tools",
		"docker/toolbox/scanner-data/semgrep-rules",
		"bun.lock",
	]),
	scannerVersion: raw.version,
	scannerMode: "explicit-host-evaluation",
	durationMs: Math.round(performance.now() - started),
	scope:
		"Four labelled SQL sinks, not all findings or whole-project precision/recall. Unlabelled findings require manual triage.",
	metrics: { tp, fp, fn, tn, recall, precision },
	cases,
	capabilityThresholdMet:
		recall !== null &&
		precision !== null &&
		recall >= manifest.minimumRecall &&
		precision >= manifest.minimumPrecision,
	findings: observations,
};
const output = path.join(
	".artifacts/improvement",
	`java-external-${crypto.randomUUID()}.json`,
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
	JSON.stringify({
		output,
		status: report.status,
		metrics: report.metrics,
		capabilityThresholdMet: report.capabilityThresholdMet,
	}),
);
if (
	process.argv.includes("--require-threshold") &&
	!report.capabilityThresholdMet
)
	process.exitCode = 1;
