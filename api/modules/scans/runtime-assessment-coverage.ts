import type {
	DastCoverageStatus,
	DastCoverageSummary,
} from "../../../shared/schemas/dast-coverage.schema";
import type { ScanProfileStepResult } from "./profile-runner";

export type RuntimeStepCoverage = {
	stepId: string;
	applicability: "applicable" | "not_applicable";
	coverageEffect: "covered" | "partial" | "gap";
	planned: number;
	attempted: number;
	succeeded: number;
	failed: number;
	limitationCodes: string[];
	requestCount: number;
};

export type RuntimeAssessmentCoverage = {
	coverageStatus: DastCoverageStatus;
	planned: number;
	attempted: number;
	succeeded: number;
	failed: number;
	requestCount: number;
	limitationCodes: string[];
	steps: RuntimeStepCoverage[];
};

export function aggregateRuntimeAssessmentCoverage(
	results: ScanProfileStepResult[],
): RuntimeAssessmentCoverage {
	const steps = results.flatMap(toRuntimeStepCoverage);
	const limitationCodes = [
		...new Set(steps.flatMap((step) => step.limitationCodes)),
	].sort();
	const requestCount = sum(steps, "requestCount");
	if (requestCount > 250) {
		limitationCodes.push("aggregate_request_budget_exceeded");
	}
	const coverageStatus: DastCoverageStatus =
		steps.length === 0 || steps.every((step) => step.coverageEffect === "gap")
			? "gap"
			: requestCount <= 250 &&
					steps.every((step) => step.coverageEffect === "covered")
				? "covered"
				: "partial";
	return {
		coverageStatus,
		planned: sum(steps, "planned"),
		attempted: sum(steps, "attempted"),
		succeeded: sum(steps, "succeeded"),
		failed: sum(steps, "failed"),
		requestCount,
		limitationCodes,
		steps,
	};
}

function toRuntimeStepCoverage(
	result: ScanProfileStepResult,
): RuntimeStepCoverage[] {
	if (result.kind === "static_tool") return [];
	if (result.kind === "dast") {
		const summary = isDastCoverageSummary(result.coverageSummary)
			? result.coverageSummary
			: null;
		return [
			{
				stepId: `dast:${result.profileId}`,
				applicability:
					result.status === "skipped" ? "not_applicable" : "applicable",
				coverageEffect: result.coverageStatus ?? "gap",
				planned: summary?.plannedRouteCount ?? 0,
				attempted: summary?.attemptedRouteCount ?? 0,
				succeeded: summary?.successfulRouteCount ?? 0,
				failed: summary?.failedRouteCount ?? 0,
				limitationCodes: result.limitationCodes ?? [],
				requestCount: summary?.requestCount ?? 0,
			},
		];
	}
	const gateway = asRecord(result.metadata?.gatewayMetrics);
	const budgetBlocked = numberValue(gateway?.budgetBlockedRequests);
	const requestCount = numberValue(gateway?.forwardedRequests);
	const truncatedResponses = numberValue(
		gateway?.responseBodyTruncatedResponses,
	);
	const noRequests =
		result.applicability === "applicable" &&
		result.status === "completed" &&
		requestCount === 0;
	const coverageEffect = noRequests
		? "gap"
		: budgetBlocked > 0 || truncatedResponses > 0
			? "partial"
			: result.status === "completed"
				? result.coverageEffect
				: "gap";
	return [
		{
			stepId: result.stepId,
			applicability: result.applicability,
			coverageEffect,
			planned: requestCount + budgetBlocked,
			attempted: requestCount,
			succeeded: result.status === "completed" ? requestCount : 0,
			failed: result.status === "failed" ? Math.max(requestCount, 1) : 0,
			limitationCodes: [
				...(result.reasonCode ? [result.reasonCode] : []),
				...(budgetBlocked > 0 ? ["request_budget_exhausted"] : []),
				...(truncatedResponses > 0 ? ["response_body_truncated"] : []),
				...(noRequests ? ["runtime_no_requests"] : []),
			],
			requestCount,
		},
	];
}

function isDastCoverageSummary(
	value: DastCoverageSummary | null | undefined,
): value is DastCoverageSummary {
	return (
		value !== null &&
		value !== undefined &&
		typeof value.requestCount === "number" &&
		typeof value.attemptedRouteCount === "number"
	);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sum(
	steps: RuntimeStepCoverage[],
	key: "planned" | "attempted" | "succeeded" | "failed" | "requestCount",
): number {
	return steps.reduce((total, step) => total + step[key], 0);
}
