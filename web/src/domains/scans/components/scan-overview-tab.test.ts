import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScanRun } from "../../../api";
import { ScanOverviewTab } from "./scan-overview-tab";

const now = "2026-08-21T00:00:00.000Z";

function scan(
	status: ScanRun["status"],
	overrides: Partial<ScanRun> = {},
): ScanRun {
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
		...overrides,
	};
}

function render(status: ScanRun["status"], overrides: Partial<ScanRun> = {}) {
	return renderToStaticMarkup(
		createElement(ScanOverviewTab, {
			findings: [],
			scanRuns: [scan(status, overrides)],
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

	it("explains a pre-execution failure without presenting zero findings as safe", () => {
		const markup = render("failed", {
			summary: "Scan failed because the execution plan changed after preview.",
			metadata: {
				terminationReason: "plan_changed",
				executionPlan: {
					blockerCodes: ["runtime_isolation_provider_unavailable"],
				},
			},
		});

		expect(markup).toContain('aria-labelledby="scan-failure-scan-1"');
		expect(markup).toContain("隔離実行環境が未設定");
		expect(markup).toContain("次に行うこと");
		expect(markup).toContain("スキャナーは実行されていません");
		expect(markup).toContain("検査未実施");
		expect(markup).toContain("重要度別の検出数を集計できません");
		expect(markup).toContain("カバレッジ</span><strong>未確定");
		expect(markup).toContain("runtime_isolation_provider_unavailable");
		expect(markup).not.toContain("検出結果はありません。");
	});

	it("keeps the execution message available when no structured reason code exists", () => {
		const markup = render("failed", {
			summary: "Scanner process exited unexpectedly.",
		});

		expect(markup).toContain("スキャンを完了できませんでした");
		expect(markup).toContain("技術情報を表示");
		expect(markup).toContain("Scanner process exited unexpectedly.");
		expect(markup).toContain("結果未確定");
		expect(markup).toContain(
			"スキャンが完了していないため、検出結果の有無は確定していません。",
		);
		expect(markup).not.toContain("検出結果はありません。");
	});

	it("does not present a cancelled scan as complete or zero findings", () => {
		const markup = render("cancelled", {
			summary: "Cancelled by user.",
		});

		expect(markup).toContain("スキャンは中止されました");
		expect(markup).toContain("カバレッジ</span><strong>未確定");
		expect(markup).toContain("結果未確定");
		expect(markup).not.toContain("検出結果はありません。");
	});
});
