import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseOwaspExpectedResults } from "../../api/modules/benchmarks/owasp-benchmark-adapter";
import {
	normalizeCwe,
	scoreBenchmark,
} from "../../api/modules/benchmarks/metric-scorer";

type RawResult = {
	check_id?: string;
	path?: string;
	extra?: { metadata?: { cwe?: string | string[] } };
};

const expectedPath = path.resolve(
	process.env.VULN_WORKBENCH_SECURITY_CORPORA_ROOT ?? ".cache/security-corpora",
	"owasp-benchmark-java/source/expectedresults-1.2beta.csv",
);
const rawPath = path.resolve(".artifacts/benchmark/owasp-semgrep-raw.json");
const expected = parseOwaspExpectedResults(
	await readFile(expectedPath, "utf8"),
);
const expectedByTest = new Map(expected.map((entry) => [entry.testId, entry]));
const raw = JSON.parse(await readFile(rawPath, "utf8")) as {
	results?: RawResult[];
};
const observations: Array<{ testId: string; category: string; cwe: string }> =
	[];
const rulesByObservation = new Map<string, Set<string>>();

for (const result of raw.results ?? []) {
	const testId = result.path?.match(/BenchmarkTest\d{5}/)?.[0];
	const truth = testId ? expectedByTest.get(testId) : undefined;
	if (!testId || !truth) continue;
	const cwes = Array.isArray(result.extra?.metadata?.cwe)
		? result.extra.metadata.cwe
		: result.extra?.metadata?.cwe
			? [result.extra.metadata.cwe]
			: [];
	for (const cweValue of cwes) {
		const cwe = normalizeCwe(cweValue);
		observations.push({ testId, category: truth.category, cwe });
		const key = `${truth.category}:${testId}:${cwe}`;
		const rules = rulesByObservation.get(key) ?? new Set<string>();
		rules.add(result.check_id ?? "unknown-rule");
		rulesByObservation.set(key, rules);
	}
}

const score = scoreBenchmark(expected, observations);
const falseNegatives = expected.filter(
	(entry) =>
		entry.vulnerable &&
		!rulesByObservation.has(`${entry.category}:${entry.testId}:${entry.cwe}`),
);
const falsePositiveKeys = new Set<string>();
for (const entry of expected) {
	if (
		!entry.vulnerable &&
		rulesByObservation.has(`${entry.category}:${entry.testId}:${entry.cwe}`)
	) {
		falsePositiveKeys.add(`${entry.category}:${entry.testId}:${entry.cwe}`);
	}
}
for (const observation of score.unmappedObservations) {
	falsePositiveKeys.add(
		`${observation.category}:${observation.testId}:${observation.cwe}`,
	);
}

const countBy = (values: Iterable<string>): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return Object.fromEntries(
		Object.entries(counts).sort(
			([left, leftCount], [right, rightCount]) =>
				rightCount - leftCount || left.localeCompare(right),
		),
	);
};
const falsePositiveRules = countBy(
	[...falsePositiveKeys].flatMap((key) => [
		...(rulesByObservation.get(key) ?? ["unknown-rule"]),
	]),
);
const report = {
	schemaVersion: 1,
	corpus: "owasp-benchmark-java-1.2beta",
	falseNegativeCount: falseNegatives.length,
	falsePositiveCount: falsePositiveKeys.size,
	falseNegativesByCategory: countBy(
		falseNegatives.map((entry) => entry.category),
	),
	falsePositivesByCategory: countBy(
		[...falsePositiveKeys].map((key) => key.split(":", 1)[0] ?? "unknown"),
	),
	falsePositivesByRule: falsePositiveRules,
	priority:
		"Reduce path traversal, SQL injection, and XSS false positives with paired negative fixtures before expanding recall; do not change benchmark-policy.v1.json.",
	falseNegativeTestIds: falseNegatives.map((entry) => entry.testId).sort(),
	falsePositiveObservationKeys: [...falsePositiveKeys].sort(),
};
const overall = score.metrics.find((metric) => metric.category === "overall");
if (
	overall?.falseNegative !== report.falseNegativeCount ||
	overall.falsePositive !== report.falsePositiveCount
) {
	throw new Error(
		"OWASP failure analysis does not reconcile with scored metrics.",
	);
}
const output = path.resolve(".artifacts/benchmark/owasp-failure-analysis.json");
await mkdir(path.dirname(output), { recursive: true });
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
	`${JSON.stringify({
		ok: true,
		output: path.relative(process.cwd(), output),
		falseNegativeCount: report.falseNegativeCount,
		falsePositiveCount: report.falsePositiveCount,
		falseNegativesByCategory: report.falseNegativesByCategory,
		falsePositivesByCategory: report.falsePositivesByCategory,
	})}\n`,
);
