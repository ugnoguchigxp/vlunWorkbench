import { describe, expect, test } from "bun:test";
import { executeBusinessLogicScenario } from "../../api/modules/business-logic/business-logic-scenario-executor";
import { measureBusinessLogicPairs } from "./business-logic-measurement";

describe("business logic measurements", () => {
	test("scores stateful HTTP executions and verified resets", async () => {
		const report = await measureBusinessLogicPairs();
		expect(report.measurementStatus).toBe("completed");
		expect(report.executions).toHaveLength(16);
		expect(report.metrics.at(-1)).toMatchObject({ truePositive: 8, trueNegative: 8, falsePositive: 0, falseNegative: 0 });
		expect(report.executions.every((e) => e.requests.some((r) => r.stage === "cleanup" && r.status === 204))).toBe(true);
	});
	test("a detector that misses everything earns zero recall", async () => {
		const report = await measureBusinessLogicPairs(async (params) => ({ ...await executeBusinessLogicScenario(params), status: "not_observed" }));
		expect(report.metrics.at(-1)).toMatchObject({ truePositive: 0, falseNegative: 8, recall: 0 });
	});
	test("an incomplete or unexecuted pair cannot be a completed measurement", async () => {
		const report = await measureBusinessLogicPairs(async () => ({ status: "observed", requestCount: 0, evidenceRefs: [], violatedInvariantIndexes: [0], cleanupSucceeded: true, errors: [] }));
		expect(report.measurementStatus).toBe("incomplete");
	});
});
