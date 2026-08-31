import { describe, expect, test } from "bun:test";
import { evaluateScanGate } from "./scan-result-policy";

describe("evaluateScanGate", () => {
	test("keeps advisory scans informational", () => {
		expect(
			evaluateScanGate({
				resultPolicy: "advisory",
				gateThreshold: "high",
				profileOutcome: "completed",
				findings: [{ severity: "critical" }],
			}),
		).toMatchObject({ gateDecision: "not_requested" });
	});

	test("fails a gate for a finding at or above its threshold", () => {
		expect(
			evaluateScanGate({
				resultPolicy: "gate",
				gateThreshold: "high",
				profileOutcome: "completed_with_warnings",
				findings: [{ severity: "medium" }, { severity: "high" }],
			}),
		).toMatchObject({ gateDecision: "fail", blockingFindingCount: 1 });
	});

	test("does not pass a gate when profile execution failed", () => {
		expect(
			evaluateScanGate({
				resultPolicy: "gate",
				gateThreshold: "high",
				profileOutcome: "failed",
				findings: [],
			}),
		).toMatchObject({ gateDecision: "blocked" });
	});

	test("blocks a gate when a finding has an unknown severity", () => {
		expect(
			evaluateScanGate({
				resultPolicy: "gate",
				gateThreshold: "high",
				profileOutcome: "completed",
				findings: [{ severity: "unclassified" }],
			}),
		).toMatchObject({
			gateDecision: "blocked",
			reason: "finding_severity_unknown",
		});
	});
});
