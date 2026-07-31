import { describe, expect, it } from "vitest";
import { assessJuiceShopMeasurement } from "./measurement-status";

describe("assessJuiceShopMeasurement", () => {
	it("does not label a zero-observation run as completed", () => {
		expect(
			assessJuiceShopMeasurement({
				executedScenarioCount: 0,
				eligibleScenarioCount: 20,
			}),
		).toEqual({ status: "not_executed", reason: "observations_missing" });
	});

	it("distinguishes partial from complete observation sets", () => {
		expect(
			assessJuiceShopMeasurement({
				executedScenarioCount: 19,
				eligibleScenarioCount: 20,
			}).status,
		).toBe("incomplete");
		expect(
			assessJuiceShopMeasurement({
				executedScenarioCount: 20,
				eligibleScenarioCount: 20,
			}),
		).toEqual({ status: "completed", reason: null });
	});
});
