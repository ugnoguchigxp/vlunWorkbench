import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScanRun } from "../../../api";
import { ScanOverviewTab } from "./scan-overview-tab";

const now = "2026-08-21T00:00:00.000Z";

function scan(status: ScanRun["status"]): ScanRun {
	return {
		id: "scan-1",
		projectId: "project-1",
		profile: "baseline",
		status,
		startedAt: status === "queued" ? null : now,
		completedAt: status === "completed" ? now : null,
		createdByUserId: null,
		summary: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
	};
}

function render(status: ScanRun["status"]) {
	return renderToStaticMarkup(
		createElement(ScanOverviewTab, {
			findings: [],
			scanRuns: [scan(status)],
			selectedScanRunId: "scan-1",
			coverageGaps: 0,
			selectedFindingId: "",
			scanReviews: [],
			generatingImprovementRequest: false,
			onSelectFinding: () => undefined,
			onCloseFinding: () => undefined,
			onGenerateImprovementRequest: () => undefined,
		}),
	);
}

describe("ScanOverviewTab", () => {
	it.each(["queued", "running"] as const)(
		"shows pending results while the scan is %s",
		(status) => {
			const markup = render(status);

			expect(markup).toContain(
				"スキャン中です。収集済みの検出結果を随時更新します。",
			);
			expect(markup).not.toContain("検出結果はありません。");
		},
	);

	it("shows an empty result only after completion", () => {
		const markup = render("completed");

		expect(markup).toContain("検出結果はありません。");
		expect(markup).not.toContain("収集済みの検出結果を随時更新します。");
	});
});
