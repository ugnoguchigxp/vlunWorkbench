import { describe, expect, it } from "vitest";
import type { Finding } from "../../api";
import { buildScanWorkspaceViewModel } from "./scans-workspace-view-model";

describe("scan workspace view model", () => {
	it("summarizes every finding by severity", () => {
		const finding = (
			id: string,
			severity: Finding["severity"],
			confidence: Finding["confidence"] = "static",
		): Finding => ({
			id,
			scanRunId: "scan-1",
			projectId: "project-1",
			sourceTool: "fixture",
			ruleId: "rule",
			title: id,
			description: "fixture",
			severity,
			confidence,
			status: "open",
			primaryLocation: null,
			fingerprint: id,
			metadata: {},
			createdAt: "2026-08-20T12:00:00.000Z",
			updatedAt: "2026-08-20T12:00:00.000Z",
		});
		const view = buildScanWorkspaceViewModel({
			findings: [
				finding("high-b", "high"),
				finding("critical-b", "critical"),
				finding("critical-a", "critical"),
				finding("low-a", "low"),
			],
			scanRuns: [],
			selectedScanRunId: "",
			coverageGaps: 2,
		});
		expect(view.severityCounts.critical).toBe(2);
		expect(view.severityCounts.high).toBe(1);
		expect(view.severityCounts.low).toBe(1);
	});
});
