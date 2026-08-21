import { describe, expect, it } from "vitest";
import { isScanLaunchInProgress } from "./scan-launch-state";

describe("scan launch state", () => {
	it("stays active while the launch request or scan execution is active", () => {
		expect(isScanLaunchInProgress(true, [])).toBe(true);
		expect(isScanLaunchInProgress(false, [{ status: "queued" }])).toBe(true);
		expect(isScanLaunchInProgress(false, [{ status: "running" }])).toBe(true);
	});

	it.each(["completed", "failed", "cancelled"] as const)(
		"releases the launch action after %s",
		(status) => {
			expect(isScanLaunchInProgress(false, [{ status }])).toBe(false);
		},
	);
});
