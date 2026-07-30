import type {
	BenchmarkGroundTruth,
	BenchmarkObservation,
} from "./metric-scorer";
import { normalizeCwe } from "./metric-scorer";

export function parseOwaspExpectedResults(csv: string): BenchmarkGroundTruth[] {
	const results: BenchmarkGroundTruth[] = [];
	for (const [index, line] of csv.split(/\r?\n/).entries()) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const columns = parseCsvLine(line);
		if (columns.length < 4)
			throw new Error(`invalid_expected_results_row:${index + 1}`);
		const [testId, category, vulnerable, cwe] = columns;
		if (!/^BenchmarkTest\d{5}$/.test(testId))
			throw new Error(`invalid_benchmark_test_id:${testId}`);
		if (vulnerable !== "true" && vulnerable !== "false")
			throw new Error(`invalid_vulnerability_flag:${testId}`);
		results.push({
			testId,
			category,
			vulnerable: vulnerable === "true",
			cwe: normalizeCwe(cwe),
		});
	}
	if (results.length === 0) throw new Error("expected_results_empty");
	return results;
}

export function mapSemgrepFindingToObservation(finding: {
	path: string;
	cwe: string | number;
	category: string;
}): BenchmarkObservation | null {
	const testId = finding.path.match(/BenchmarkTest\d{5}/)?.[0];
	if (!testId) return null;
	return {
		testId,
		category: finding.category,
		cwe: normalizeCwe(finding.cwe),
	};
}

function parseCsvLine(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index++) {
		const char = line[index];
		if (char === '"') {
			if (quoted && line[index + 1] === '"') {
				current += '"';
				index++;
			} else quoted = !quoted;
		} else if (char === "," && !quoted) {
			fields.push(current.trim());
			current = "";
		} else current += char;
	}
	if (quoted) throw new Error("invalid_csv_quote");
	fields.push(current.trim());
	return fields;
}
