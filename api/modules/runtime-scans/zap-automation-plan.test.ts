import { describe, expect, test } from "bun:test";
import { buildZapAutomationPlan } from "./zap-automation-plan";

describe("ZAP Automation Framework plan", () => {
	test("fixes job order and enables only declared low-strength rules", () => {
		const plan = buildZapAutomationPlan({
			contextName: "fixture",
			targetOrigin: "http://host.docker.internal:3000",
			allowedPaths: ["/api"],
			rules: [{ id: 40012 }, { id: 40018 }],
			maxDurationMinutes: 10,
			reportFilename: "zap-active.json",
		});
		expect(plan.jobs.map((job) => job.type)).toEqual([
			"passiveScan-config",
			"spider",
			"passiveScan-wait",
			"activeScan-config",
			"activeScan",
			"report",
			"exitStatus",
		]);
		expect(plan.enabledRuleIds).toEqual([40012, 40018]);
		expect(plan.yaml).toContain('defaultThreshold: "Off"');
		expect(plan.yaml).toContain('strength: "Low"');
		expect(plan.yaml).not.toContain("Insane");
	});

	test("rejects duplicate rules and high strength at the schema boundary", () => {
		expect(() =>
			buildZapAutomationPlan({
				contextName: "fixture",
				targetOrigin: "http://host.docker.internal:3000",
				allowedPaths: ["/"],
				rules: [{ id: 40012 }, { id: 40012 }],
				maxDurationMinutes: 10,
				reportFilename: "zap-active.json",
			}),
		).toThrow("duplicate");
		expect(() =>
			buildZapAutomationPlan({
				contextName: "fixture",
				targetOrigin: "http://host.docker.internal:3000",
				allowedPaths: ["/"],
				rules: [{ id: 40012, strength: "High" as never }],
				maxDurationMinutes: 10,
				reportFilename: "zap-active.json",
			}),
		).toThrow();
		expect(() =>
			buildZapAutomationPlan({
				contextName: "fixture",
				targetOrigin: "http://host.docker.internal:3000",
				allowedPaths: ["/"],
				rules: [{ id: 1 }],
				maxDurationMinutes: 10,
				reportFilename: "zap-active.json",
			}),
		).toThrow("not_allowed");
	});
});
