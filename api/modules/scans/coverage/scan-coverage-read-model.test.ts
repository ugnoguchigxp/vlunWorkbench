import { describe, expect, it } from "vitest";
import { buildScanCoverageReadModel } from "./scan-coverage-read-model";

describe("scan coverage read model", () => {
	it("keeps source SAST gap separate from control results", () => {
		const model = buildScanCoverageReadModel({
			scanMetadata: {
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
			},
			controls: [
				{
					controlId: "ASVS-v5.0.0-1.2.4",
					status: "not_tested",
					method: "automated",
					reasonCode: "scanner_not_run",
					evidenceRefs: [],
				},
			],
		});
		expect(model.sourceSast?.coverageEffect).toBe("gap");
		expect(model.ledger).toBeNull();
		expect(model.normalizedStepResults).toEqual([]);
		expect(model.controls[0]?.status).toBe("not_tested");
	});
});
