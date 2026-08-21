import { describe, expect, it } from "vitest";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
import type { ScanProfileStepResult } from "./profile-runner";
import { aggregateRuntimeAssessmentCoverage } from "./runtime-assessment-coverage";

describe("aggregateRuntimeAssessmentCoverage", () => {
	it("keeps a ZAP gateway budget block as partial coverage", () => {
		const results: ScanProfileStepResult[] = [
			{
				kind: "runtime_scanner",
				stepId: "runtime_scanner:zap-baseline",
				adapter: "zap-baseline",
				required: false,
				status: "completed",
				applicability: "applicable",
				reasonCode: null,
				coverageEffect: "covered",
				findingCount: 0,
				error: null,
				metadata: {
					gatewayMetrics: {
						forwardedRequests: 100,
						budgetBlockedRequests: 1,
					},
				},
			},
		];

		const coverage = aggregateRuntimeAssessmentCoverage(results);
		expect(coverage.coverageStatus).toBe("partial");
		expect(coverage.requestCount).toBe(100);
		expect(coverage.limitationCodes).toContain(
			"request_budget_exhausted",
		);
	});

	it("treats an unavailable schema scanner as a visible gap", () => {
		const results: ScanProfileStepResult[] = [
			{
				kind: "api_schema_scan",
				stepId: "api_schema_scan:schemathesis-readonly",
				adapter: "schemathesis-readonly",
				required: false,
				status: "skipped",
				applicability: "not_applicable",
				reasonCode: "openapi_schema_not_found",
				coverageEffect: "gap",
				findingCount: 0,
				error: null,
			},
		];

		const coverage = aggregateRuntimeAssessmentCoverage(results);
		expect(coverage.coverageStatus).toBe("gap");
		expect(coverage.limitationCodes).toContain("openapi_schema_not_found");
	});

	it("fails aggregate coverage closed if scanner metrics exceed 250 requests", () => {
		const result = {
			kind: "runtime_scanner",
			stepId: "runtime_scanner:zap-baseline",
			adapter: "zap-baseline",
			required: false,
			status: "completed",
			applicability: "applicable",
			reasonCode: null,
			coverageEffect: "covered",
			findingCount: 0,
			error: null,
			metadata: {
				gatewayMetrics: {
					forwardedRequests: 251,
					budgetBlockedRequests: 0,
				},
			},
		} as const;

		const coverage = aggregateRuntimeAssessmentCoverage([result]);
		expect(coverage.coverageStatus).toBe("partial");
		expect(coverage.limitationCodes).toContain(
			"aggregate_request_budget_exceeded",
		);
	});

	it("does not report a completed runtime scanner with no requests as covered", () => {
		const result = {
			kind: "runtime_scanner",
			stepId: "runtime_scanner:zap-baseline",
			adapter: "zap-baseline",
			required: false,
			status: "completed",
			applicability: "applicable",
			reasonCode: null,
			coverageEffect: "covered",
			findingCount: 0,
			error: null,
			metadata: {
				gatewayMetrics: {
					forwardedRequests: 0,
					budgetBlockedRequests: 0,
				},
			},
		} as const;

		const coverage = aggregateRuntimeAssessmentCoverage([result]);
		expect(coverage.coverageStatus).toBe("gap");
		expect(coverage.limitationCodes).toContain("runtime_no_requests");
	});

	it("treats a runtime target that stops during scanning as a coverage gap", () => {
		const result = {
			kind: "runtime_scanner",
			stepId: "runtime_scanner:nuclei-safe",
			adapter: "nuclei-safe",
			required: true,
			status: "failed",
			applicability: "applicable",
			reasonCode: "runtime_target_stopped",
			coverageEffect: "covered",
			findingCount: 0,
			error: "target stopped",
			metadata: {
				gatewayMetrics: {
					forwardedRequests: 1,
					budgetBlockedRequests: 0,
				},
			},
		} as const;

		const coverage = aggregateRuntimeAssessmentCoverage([result]);
		expect(coverage.coverageStatus).toBe("gap");
		expect(coverage.requestCount).toBe(1);
		expect(coverage.failed).toBe(1);
		expect(coverage.limitationCodes).toContain("runtime_target_stopped");
		recordScannerE2EFailureObservation("FI-08", {
			profileOutcome: "failed",
			reasonCodes: [result.reasonCode],
			scannerProcessCount: 1,
			toolRunCount: 1,
			requestCount: coverage.requestCount,
		});
	});
});
