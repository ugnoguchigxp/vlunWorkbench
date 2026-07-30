import { describe, expect, it } from "vitest";
import { integrationReportDetailSchema } from "../../../../shared/schemas/nightworkers-security-scan-integration.schema";
import { projectIntegrationReport } from "./nightworkers-integration-projection";

function completedReport() {
	return {
		id: "report-1",
		scanRunId: "scan-1",
		artifactId: "artifact-1",
		format: "markdown",
		title: "Security report",
		summary: null,
		options: {
			summaryMode: "deterministic_with_llm_summary",
			providerRouting: {
				providerName: "Azure OpenAI",
				providerEndpointId: "azure-primary",
				model: "gpt-5.4-mini",
			},
		},
		status: "completed",
		attemptCount: 1,
		errorCode: null,
		errorMessage: null,
		retryable: null,
		generatedByUserId: "user-1",
		startedAt: new Date("2026-07-30T00:00:01.000Z"),
		completedAt: new Date("2026-07-30T00:00:02.000Z"),
		createdAt: new Date("2026-07-30T00:00:00.000Z"),
		updatedAt: new Date("2026-07-30T00:00:02.000Z"),
	};
}

describe("NightWorkers report projection", () => {
	it("exposes bounded LLM and content metadata for the matching artifact", () => {
		const projected = projectIntegrationReport(completedReport(), {
			sizeBytes: 123,
			sha256: "a".repeat(64),
			kind: "report",
			format: "markdown",
			metadata: { reportId: "report-1" },
		});

		expect(integrationReportDetailSchema.parse(projected)).toEqual(projected);
		expect(projected.llm).toEqual({
			provider: "Azure OpenAI",
			model: "gpt-5.4-mini",
		});
		expect(projected.content?.byteLength).toBe(123);
	});

	it("does not expose content metadata for a mismatched artifact", () => {
		const projected = projectIntegrationReport(completedReport(), {
			sizeBytes: 123,
			sha256: "a".repeat(64),
			kind: "raw_result",
			format: "json",
			metadata: { reportId: "report-1" },
		});

		expect(projected.content).toBeNull();
	});

	it("does not expose persisted provider errors in a failed report", () => {
		const projected = projectIntegrationReport({
			...completedReport(),
			status: "failed",
			artifactId: null,
			errorCode: "Provider failed at /private/tmp/report.sql",
			errorMessage:
				"SQL error for token vwi_0123456789abcdef_abcdefghijklmnopqrstuvwxyzABCDEFGHijk",
		});

		expect(integrationReportDetailSchema.parse(projected)).toEqual(projected);
		expect(projected.error).toEqual({
			code: "provider_failed_at_private_tmp_report.sql",
			message: "Report generation failed.",
			retryable: false,
		});
		expect(JSON.stringify(projected)).not.toContain("/private/tmp");
		expect(JSON.stringify(projected)).not.toContain("vwi_");
	});
});
