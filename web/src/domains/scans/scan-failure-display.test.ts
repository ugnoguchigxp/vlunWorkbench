import { describe, expect, it } from "vitest";
import type { ScanRun } from "../../api";
import { buildScanFailureDisplay } from "./scan-failure-display";

const now = "2026-08-22T00:00:00.000Z";

function failedScan(
	metadata: Record<string, unknown>,
	summary = "The scan failed.",
): ScanRun {
	return {
		id: "scan-1",
		projectId: "project-1",
		profile: "runtime-web-safe",
		status: "failed",
		startedAt: now,
		completedAt: now,
		createdByUserId: null,
		summary,
		metadata,
		createdAt: now,
		updatedAt: now,
	};
}

describe("buildScanFailureDisplay", () => {
	it("explains a plan blocker and makes clear that scanners did not run", () => {
		const display = buildScanFailureDisplay(
			failedScan({
				terminationReason: "plan_changed",
				executionPlan: {
					blockerCodes: ["runtime_isolation_provider_unavailable"],
				},
			}),
		);

		expect(display).toMatchObject({
			title: expect.stringContaining("隔離実行環境が未設定"),
			noScannerExecution: true,
			reasonCodes: ["runtime_isolation_provider_unavailable"],
		});
	});

	it("does not mistake a coverage limitation for the cause of an execution failure", () => {
		const display = buildScanFailureDisplay(
			failedScan({
				terminationReason: "scanner_failed",
				profileLimitationCodes: ["target_start_not_supported"],
			}),
		);

		expect(display).toMatchObject({
			title: "スキャンを完了できませんでした",
			noScannerExecution: false,
		});
		expect(display?.explanation).toContain("実行中にエラー");
	});
});
