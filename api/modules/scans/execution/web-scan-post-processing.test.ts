import { describe, expect, it, vi } from "vitest";
import {
	finalizeWebScanAfterDiagnostic,
	runWebScanPostProcessing,
} from "./web-scan-post-processing";

const completedDiagnostic = {
	diagnosticRunId: "diagnostic-1",
	status: "completed" as const,
	readiness: "ready" as const,
	reviewId: "review-1",
	reportId: "preliminary-1",
	limitations: [],
};

describe("Web scan post-processing", () => {
	it("finalizes only after the automatic diagnostic completes", async () => {
		const order: string[] = [];
		const createScanEvent = vi.fn();
		const finalize = vi.fn(async () => {
			order.push("finalize");
			return {
				ok: true,
				reportId: "final-1",
				artifactId: "artifact-1",
				artifactPath: "scan/final.md",
				status: "completed" as const,
				error: null,
			};
		});
		await runWebScanPostProcessing({
			scanRunId: "scan-1",
			db: {} as never,
			scanRepository: {
				findById: vi.fn(async () => ({
					metadata: {
						finalReportRequest: {
							requested: true,
							title: "Web final report",
						},
					},
				})) as never,
				createScanEvent: createScanEvent as never,
			},
			diagnosticRunner: {
				run: vi.fn(async () => {
					order.push("diagnostic");
					return completedDiagnostic;
				}) as never,
			},
			finalize: finalize as never,
		});

		expect(order).toEqual(["diagnostic", "finalize"]);
		expect(finalize).toHaveBeenCalledWith(
			expect.objectContaining({
				scanRunId: "scan-1",
				options: expect.objectContaining({ title: "Web final report" }),
			}),
		);
		expect(createScanEvent).not.toHaveBeenCalled();
	});

	it("does not finalize when the Web request disabled the final report", async () => {
		const finalize = vi.fn();
		await runWebScanPostProcessing({
			scanRunId: "scan-1",
			db: {} as never,
			scanRepository: {
				findById: vi.fn(async () => ({
					metadata: { finalReportRequest: { requested: false } },
				})) as never,
				createScanEvent: vi.fn() as never,
			},
			diagnosticRunner: {
				run: vi.fn(async () => completedDiagnostic) as never,
			},
			finalize: finalize as never,
		});

		expect(finalize).not.toHaveBeenCalled();
	});

	it("can finalize a recovered diagnostic without rerunning it", async () => {
		const finalize = vi.fn(async () => ({
			ok: true,
			reportId: "final-1",
			artifactId: "artifact-1",
			artifactPath: "scan/final.md",
			status: "completed" as const,
			error: null,
		}));
		await finalizeWebScanAfterDiagnostic({
			scanRunId: "scan-1",
			db: {} as never,
			diagnostic: completedDiagnostic,
			scanRepository: {
				findById: vi.fn(async () => ({
					metadata: {
						finalReportRequest: { requested: true, title: "Recovered final" },
					},
				})) as never,
				createScanEvent: vi.fn() as never,
			},
			finalize: finalize as never,
		});

		expect(finalize).toHaveBeenCalledWith(
			expect.objectContaining({
				scanRunId: "scan-1",
				options: expect.objectContaining({ title: "Recovered final" }),
			}),
		);
	});

	it("does not report a concurrent canonical report claim as a failure", async () => {
		const createScanEvent = vi.fn();
		await finalizeWebScanAfterDiagnostic({
			scanRunId: "scan-1",
			db: {} as never,
			diagnostic: completedDiagnostic,
			scanRepository: {
				findById: vi.fn(async () => ({
					metadata: {
						finalReportRequest: { requested: true, title: "Final" },
					},
				})) as never,
				createScanEvent: createScanEvent as never,
			},
			finalize: vi.fn(async () => ({
				ok: false,
				reportId: null,
				artifactId: null,
				artifactPath: null,
				status: "skipped" as const,
				error: "canonical_final_report_in_progress",
			})) as never,
		});

		expect(createScanEvent).not.toHaveBeenCalled();
	});

	it("ignores non-terminal diagnostics without reading scan metadata", async () => {
		const findById = vi.fn();
		await finalizeWebScanAfterDiagnostic({
			scanRunId: "scan-1",
			db: {} as never,
			diagnostic: {
				...completedDiagnostic,
				status: "failed",
				readiness: "failed",
				error: "diagnostic failed",
			},
			scanRepository: {
				findById: findById as never,
				createScanEvent: vi.fn() as never,
			},
			finalize: vi.fn() as never,
		});

		expect(findById).not.toHaveBeenCalled();
	});

	it.each([
		null,
		[],
		{},
		{ finalReportRequest: null },
		{ finalReportRequest: [] },
	])("does not infer a final-report request from invalid metadata %#", async (metadata) => {
		const finalize = vi.fn();
		await finalizeWebScanAfterDiagnostic({
			scanRunId: "scan-1",
			db: {} as never,
			diagnostic: completedDiagnostic,
			scanRepository: {
				findById: vi.fn(async () => ({ metadata })) as never,
				createScanEvent: vi.fn() as never,
			},
			finalize: finalize as never,
		});
		expect(finalize).not.toHaveBeenCalled();
	});

	it("uses the default title and records a terminal finalization failure", async () => {
		const createScanEvent = vi.fn();
		const finalize = vi.fn(async () => ({
			ok: false,
			reportId: "final-1",
			artifactId: null,
			artifactPath: null,
			status: "failed" as const,
			error: "artifact write failed",
		}));
		await finalizeWebScanAfterDiagnostic({
			scanRunId: "scan-1",
			db: {} as never,
			diagnostic: completedDiagnostic,
			scanRepository: {
				findById: vi.fn(async () => ({
					metadata: {
						finalReportRequest: { requested: true, title: "  " },
					},
				})) as never,
				createScanEvent: createScanEvent as never,
			},
			finalize: finalize as never,
		});

		expect(finalize).toHaveBeenCalledWith(
			expect.objectContaining({
				options: expect.objectContaining({
					title: "最終セキュリティレポート",
				}),
			}),
		);
		expect(createScanEvent).toHaveBeenCalledWith(
			expect.objectContaining({
				eventType: "report.finalization_failed",
				data: {
					status: "failed",
					error: "artifact write failed",
				},
			}),
		);
	});
});
