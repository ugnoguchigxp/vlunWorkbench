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

	it("preserves blocked, inconclusive, and cleanup failure states", () => {
		expect(
			assessJuiceShopMeasurement({
				eligibleScenarioCount: 20,
				observationCount: 20,
				executedScenarioCount: 0,
				blockedScenarioCount: 20,
			}),
		).toEqual({
			status: "blocked",
			reason: "scenario_dependencies_blocked",
		});
		expect(
			assessJuiceShopMeasurement({
				eligibleScenarioCount: 20,
				observationCount: 20,
				executedScenarioCount: 19,
				inconclusiveScenarioCount: 1,
			}),
		).toEqual({
			status: "incomplete",
			reason: "scenario_observations_inconclusive",
		});
		expect(
			assessJuiceShopMeasurement({
				eligibleScenarioCount: 20,
				observationCount: 20,
				executedScenarioCount: 19,
				failedCleanupScenarioCount: 1,
			}),
		).toEqual({
			status: "failed_cleanup",
			reason: "scenario_cleanup_failed",
		});
	});

	it("does not complete a run when preflight or final teardown is blocked", () => {
		expect(
			assessJuiceShopMeasurement(
				{
					eligibleScenarioCount: 20,
					observationCount: 20,
					executedScenarioCount: 20,
				},
				{ preflightStatus: "blocked" },
			),
		).toEqual({
			status: "blocked",
			reason: "runtime_preflight_or_teardown_blocked",
		});
	});
});
