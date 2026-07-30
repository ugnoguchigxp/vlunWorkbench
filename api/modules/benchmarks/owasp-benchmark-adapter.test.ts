import { describe, expect, test } from "bun:test";
import {
	mapSemgrepFindingToObservation,
	parseOwaspExpectedResults,
} from "./owasp-benchmark-adapter";

describe("OWASP Benchmark adapter", () => {
	test("parses pinned expected results and requires path plus CWE mapping", () => {
		expect(
			parseOwaspExpectedResults(`# comment
BenchmarkTest00001,pathtraver,true,22
BenchmarkTest00002,sqli,false,89
`),
		).toEqual([
			{
				testId: "BenchmarkTest00001",
				category: "pathtraver",
				vulnerable: true,
				cwe: "CWE-22",
			},
			{
				testId: "BenchmarkTest00002",
				category: "sqli",
				vulnerable: false,
				cwe: "CWE-89",
			},
		]);
		expect(
			mapSemgrepFindingToObservation({
				path: "src/BenchmarkTest00001.java",
				category: "pathtraver",
				cwe: "22",
			}),
		).toEqual({
			testId: "BenchmarkTest00001",
			category: "pathtraver",
			cwe: "CWE-22",
		});
		expect(
			mapSemgrepFindingToObservation({
				path: "src/Other.java",
				category: "pathtraver",
				cwe: "22",
			}),
		).toBeNull();
	});
});
