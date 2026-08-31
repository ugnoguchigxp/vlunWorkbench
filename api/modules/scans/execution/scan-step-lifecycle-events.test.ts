import { describe, expect, it, vi } from "vitest";
import {
	emitScanStepFinished,
	emitScanStepStarted,
} from "./scan-step-lifecycle-events";

const context = {
	scanRunId: "scan-1",
	step: {
		kind: "static_tool" as const,
		toolId: "gitleaks",
		displayName: "Gitleaks Secret Detection",
		required: true,
		failurePolicy: "fail_profile" as const,
	},
	planned: {
		stepId: "gitleaks",
		kind: "static_tool" as const,
		adapter: "gitleaks",
		required: true,
		applicability: "applicable" as const,
		readiness: "ready" as const,
		requirement: "required_if_applicable" as const,
		reasonCodes: [],
		evidenceRefs: [],
	},
	position: 1,
	totalSteps: 2,
	planHash: "sha256:test",
};

describe("scan step lifecycle events", () => {
	it("persists a normalized started and finished event", async () => {
		const scanRepo = { createScanEvent: vi.fn().mockResolvedValue({}) };
		await emitScanStepStarted(scanRepo as never, context);
		await emitScanStepFinished(scanRepo as never, context, {
			outcome: "completed",
			findingCount: 0,
			reasonCode: null,
			durationMs: 25,
		});

		expect(scanRepo.createScanEvent).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				eventType: "scan.step.started",
				level: "info",
				data: expect.objectContaining({
					stepId: "gitleaks",
					adapter: "gitleaks",
					position: 1,
				}),
			}),
		);
		expect(scanRepo.createScanEvent).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				eventType: "scan.step.finished",
				level: "info",
				data: expect.objectContaining({
					outcome: "completed",
					findingCount: 0,
					durationMs: 25,
				}),
			}),
		);
	});

	it("marks failed outcomes as errors", async () => {
		const scanRepo = { createScanEvent: vi.fn().mockResolvedValue({}) };
		await emitScanStepFinished(scanRepo as never, context, {
			outcome: "failed",
			findingCount: 0,
			reasonCode: "execution_failed",
			durationMs: null,
		});
		expect(scanRepo.createScanEvent).toHaveBeenCalledWith(
			expect.objectContaining({ level: "error" }),
		);
	});
});
