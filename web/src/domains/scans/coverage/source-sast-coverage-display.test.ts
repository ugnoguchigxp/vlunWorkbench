import { describe, expect, it } from "vitest";
import { readSourceSastCoverageDisplay } from "./source-sast-coverage-display";

describe("source SAST coverage display", () => {
	it("reads an explicit unexecuted coverage gap", () => {
		expect(
			readSourceSastCoverageDisplay({
				sourceSastCoverage: {
					capability: "source_sast",
					applicability: "applicable",
					state: "applicable",
					coverageEffect: "gap",
					stepId: null,
					engine: null,
					rulesetId: null,
					limitationCodes: ["source_sast_not_executed"],
				},
			}),
		).toMatchObject({
			coverageEffect: "gap",
			limitationCodes: ["source_sast_not_executed"],
		});
	});

	it("rejects malformed metadata", () => {
		expect(
			readSourceSastCoverageDisplay({
				sourceSastCoverage: { coverageEffect: "covered" },
			}),
		).toBeNull();
	});
});
