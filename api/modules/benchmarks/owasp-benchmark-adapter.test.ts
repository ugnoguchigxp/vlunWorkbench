import { describe, expect, test } from "bun:test";
import { scoreBenchmark } from "./metric-scorer";
import {
	buildOwaspCweCategoryMap,
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
		const categoryByCwe = buildOwaspCweCategoryMap(
			parseOwaspExpectedResults(`BenchmarkTest00001,pathtraver,true,22
BenchmarkTest00002,xss,true,79`),
		);
		expect(
			mapSemgrepFindingToObservation({
				path: "src/BenchmarkTest00001.java",
				category: "pathtraver",
				cwe: "22",
			}, categoryByCwe),
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
			}, categoryByCwe),
		).toBeNull();
	});

	test("attributes cross-CWE observations to the CWE category", () => {
		const groundTruth = [
			{
				testId: "BenchmarkTest00001",
				category: "pathtraver",
				cwe: "CWE-22",
				vulnerable: true,
			},
			{
				testId: "BenchmarkTest00002",
				category: "xss",
				cwe: "CWE-79",
				vulnerable: true,
			},
		];
		const categoryByCwe = buildOwaspCweCategoryMap(groundTruth);
		const crossCwe = mapSemgrepFindingToObservation(
				{
					path: "src/BenchmarkTest00001.java",
					category: "pathtraver",
					cwe: "CWE-79",
				},
				categoryByCwe,
			);
		expect(crossCwe).toEqual({
			testId: "BenchmarkTest00001",
			category: "xss",
			cwe: "CWE-79",
		});
		const score = scoreBenchmark(groundTruth, crossCwe ? [crossCwe] : []);
		expect(score.metrics.find((metric) => metric.category === "pathtraver"))
			.toEqual(expect.objectContaining({ falsePositive: 0 }));
		expect(score.metrics.find((metric) => metric.category === "xss")).toEqual(
			expect.objectContaining({ falsePositive: 1 }),
		);
		expect(score.metrics.find((metric) => metric.category === "overall")).toEqual(
			expect.objectContaining({ falsePositive: 1 }),
		);
		expect(
			mapSemgrepFindingToObservation(
				{
					path: "src/BenchmarkTest00001.java",
					cwe: "CWE-999",
				},
				categoryByCwe,
			),
		).toEqual({
			testId: "BenchmarkTest00001",
			category: "unmapped_cwe",
			cwe: "CWE-999",
		});
	});

	test("rejects an ambiguous CWE-to-category contract", () => {
		expect(() =>
			buildOwaspCweCategoryMap([
				{
					testId: "BenchmarkTest00001",
					category: "first",
					cwe: "CWE-79",
					vulnerable: true,
				},
				{
					testId: "BenchmarkTest00002",
					category: "second",
					cwe: "CWE-79",
					vulnerable: false,
				},
			]),
		).toThrow("ambiguous_owasp_cwe_category:CWE-79");
	});
});
