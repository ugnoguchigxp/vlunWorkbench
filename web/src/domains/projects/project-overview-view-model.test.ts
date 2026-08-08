import { describe, expect, it } from "vitest";
import type { ProjectIntelligenceView } from "../../api";
import { buildProjectOverviewPresentation } from "./project-overview-view-model";

const readinessItem = (status: string) => ({
	status,
	reasonCodes: [],
});

function source(options: {
	scan?: boolean;
	scanStatus?: "queued" | "running" | "completed" | "failed" | "cancelled";
	generation?: boolean;
	status?: "available" | "stale" | "degraded" | "missing" | "failed";
	exportPayload?: boolean;
}) {
	const status = options.status ?? "missing";
	return {
		selectedScan: options.scan
			? {
					id: "scan-1",
					profile: "baseline",
					status: options.scanStatus ?? "completed",
				}
			: null,
		generation: options.generation ? { generationId: "generation-1" } : null,
		export: options.exportPayload
			? {
					scan: { findingCount: 2 },
					scanSummary: { riskBand: "high", evidenceQuality: "strong" },
				}
			: null,
		readiness: {
			export: readinessItem(status),
			codeStructure: readinessItem(status),
		},
	} as unknown as Pick<
		ProjectIntelligenceView,
		"selectedScan" | "generation" | "export" | "readiness"
	>;
}

describe("project overview presentation", () => {
	it("separates a missing scan from unavailable intelligence", () => {
		const result = buildProjectOverviewPresentation(source({}));

		expect(result.scan).toMatchObject({
			status: "未実行",
			action: "start_scan",
		});
		expect(result.intelligence).toMatchObject({
			status: "スキャンが必要",
			action: null,
			metrics: [],
		});
	});

	it("presents completed scans with missing intelligence as generatable", () => {
		const result = buildProjectOverviewPresentation(source({ scan: true }));

		expect(result.scan.status).toBe("完了");
		expect(result.intelligence).toMatchObject({
			status: "未生成",
			action: "generate_intelligence",
			actionLabel: "Intelligenceを生成",
			metrics: [],
		});
		expect(JSON.stringify(result)).not.toContain("generation_missing");
	});

	it.each(["queued", "running"] as const)(
		"waits for a %s scan before offering Intelligence generation",
		(scanStatus) => {
			const result = buildProjectOverviewPresentation(
				source({
					scan: true,
					scanStatus,
					generation: true,
					status: "available",
					exportPayload: true,
				}),
			);

			expect(result.intelligence).toMatchObject({
				status: "スキャン完了待ち",
				tone: "progress",
				action: null,
				metrics: [],
			});
		},
	);

	it("distinguishes invalid persisted intelligence from missing intelligence", () => {
		const result = buildProjectOverviewPresentation(
			source({ scan: true, status: "failed" }),
		);

		expect(result.intelligence).toMatchObject({
			status: "生成失敗",
			tone: "danger",
			action: "retry_intelligence",
		});
	});

	it("shows compact metrics only when intelligence export is available", () => {
		const result = buildProjectOverviewPresentation(
			source({
				scan: true,
				generation: true,
				status: "available",
				exportPayload: true,
			}),
		);

		expect(result.intelligence).toMatchObject({
			status: "利用可能",
			action: "open_intelligence",
		});
		expect(result.intelligence.metrics).toEqual([
			{ label: "リスク", value: "高" },
			{ label: "根拠品質", value: "十分" },
			{ label: "Finding", value: 2 },
			{ label: "コード構造", value: "利用可能" },
		]);
	});

	it.each([
		["degraded", "一部利用可能", "open_intelligence"],
		["stale", "更新が必要", "retry_intelligence"],
	] as const)(
		"maps %s intelligence to an actionable overview state",
		(status, label, action) => {
			const result = buildProjectOverviewPresentation(
				source({ scan: true, generation: true, status }),
			);

			expect(result.intelligence).toMatchObject({ status: label, action });
		},
	);
});
