import { describe, expect, test } from "bun:test";
import { projectScanProgress } from "./scan-progress-projector";

describe("scan progress projector", () => {
	test("has a stable non-zero denominator before a scanner starts", () => {
		const snapshot = projectScanProgress({
			runId: "run-1", planHash: "sha256:plan", steps: [{ stepId: "runtime:nuclei-safe", applicability: "applicable" }],
			events: [{ seq: 1, eventType: "scan.queued", data: {} }],
		});
		expect(snapshot.totalStepCount).toBe(1);
		expect(snapshot.completedStepCount).toBe(0);
		expect(snapshot.steps[0]?.status).toBe("pending");
	});

	test("reconstructs a failed step from durable events", () => {
		const snapshot = projectScanProgress({
			runId: "run-1", planHash: "sha256:plan", steps: [{ stepId: "runtime:zap-baseline", applicability: "applicable" }],
			events: [
				{ seq: 1, eventType: "scan.step.started", data: { stepId: "runtime:zap-baseline" } },
				{ seq: 2, eventType: "scan.step.finished", data: { stepId: "runtime:zap-baseline", outcome: "failed", reasonCode: "docker_image_unavailable" } },
			],
		});
		expect(snapshot.steps[0]).toMatchObject({ status: "failed", safeMessage: "docker_image_unavailable" });
		expect(snapshot.lastEventSeq).toBe(2);
	});
});
