import type {
	DastCoverageStatus,
	DastCoverageSummary,
	DastRouteInventoryEntry,
	DastVerdict,
} from "../../../shared/schemas/dast-coverage.schema";
import type { DastOutcome } from "../../../shared/schemas/dast.schema";

export type DastCoverageEvaluation = {
	coverageStatus: DastCoverageStatus;
	coverageSummary: DastCoverageSummary;
	verdict: DastVerdict;
	outcome: DastOutcome;
	limitationCodes: string[];
};

export function evaluateDastCoverage(params: {
	routeInventory: DastRouteInventoryEntry[];
	requestCount: number;
	responseBytesRead?: number;
	findingCount: number;
	budgetExhausted?: boolean;
	authRequired?: boolean;
	authSucceeded?: boolean;
	limitationCodes?: string[];
}): DastCoverageEvaluation {
	const entries = params.routeInventory;
	const attempted = entries.filter((entry) =>
		[
			"attempted",
			"succeeded",
			"denied_expected",
			"denied_unexpected",
			"failed",
		].includes(entry.state),
	);
	const successful = entries.filter((entry) =>
		["succeeded", "denied_expected"].includes(entry.state),
	);
	const failed = entries.filter((entry) =>
		["failed", "denied_unexpected"].includes(entry.state),
	);
	const blocked = entries.filter((entry) => entry.state === "blocked");
	const notTested = entries.filter((entry) =>
		["discovered", "planned", "not_tested"].includes(entry.state),
	);
	const required = entries.filter((entry) => entry.required);
	const requiredAttempted = required.filter((entry) =>
		attempted.includes(entry),
	);
	const actionable = entries.filter(
		(entry) => entry.limitationCode !== "parameter_example_missing",
	);
	const actionableSuccessful = actionable.filter((entry) =>
		successful.includes(entry),
	);
	const transportErrors = entries.filter(
		(entry) =>
			entry.state === "failed" &&
			[
				"target_unreachable",
				"browser_unavailable",
				"browser_route_failed",
			].includes(entry.limitationCode ?? ""),
	).length;
	const timeouts = entries.filter(
		(entry) =>
			entry.limitationCode === "http_timeout" ||
			entry.limitationCode === "browser_timeout",
	).length;
	const authFailures = entries.filter(
		(entry) =>
			entry.limitationCode === "authentication_failed" ||
			entry.limitationCode === "session_expired",
	).length;
	const limitationCodes = [
		...new Set([
			...(params.limitationCodes ?? []),
			...entries.flatMap((entry) =>
				entry.limitationCode ? [entry.limitationCode] : [],
			),
			...(params.budgetExhausted ? ["request_budget_exhausted"] : []),
			...(params.authRequired && params.authSucceeded !== true
				? ["authentication_failed"]
				: []),
		]),
	].sort();
	const requiredSeedCoverage =
		required.length === 0 ? 0 : requiredAttempted.length / required.length;
	const actionableRouteCoverage =
		actionable.length === 0
			? 0
			: actionableSuccessful.length / actionable.length;
	const coverageSummary: DastCoverageSummary = {
		knownRouteCount: entries.length,
		actionableKnownRouteCount: actionable.length,
		plannedRouteCount: entries.filter((entry) => entry.state !== "discovered")
			.length,
		attemptedRouteCount: attempted.length,
		successfulRouteCount: successful.length,
		failedRouteCount: failed.length,
		blockedRouteCount: blocked.length,
		notTestedRouteCount: notTested.length,
		requiredSeedCoverage,
		actionableRouteCoverage,
		requestCount: params.requestCount,
		responseBytesRead: params.responseBytesRead ?? 0,
		maxDepthReached: entries.reduce(
			(maximum, entry) =>
				attempted.includes(entry) ? Math.max(maximum, entry.depth) : maximum,
			0,
		),
		transportErrorCount: transportErrors,
		timeoutCount: timeouts,
		authFailureCount:
			authFailures +
			(params.authRequired && params.authSucceeded !== true ? 1 : 0),
		budgetExhausted: params.budgetExhausted ?? false,
		limitationCodes,
	};

	const requestless = params.requestCount === 0;
	const authGap = params.authRequired && params.authSucceeded !== true;
	const covered =
		!requestless &&
		!authGap &&
		requiredSeedCoverage === 1 &&
		actionableRouteCoverage >= 0.9 &&
		transportErrors === 0 &&
		timeouts === 0 &&
		!params.budgetExhausted &&
		notTested.length === 0 &&
		limitationCodes.length === 0;
	const coverageStatus: DastCoverageStatus = covered
		? "covered"
		: requestless || authGap
			? "gap"
			: "partial";
	const verdict: DastVerdict =
		params.findingCount > 0
			? "findings"
			: requestless
				? "not_tested"
				: covered
					? "no_findings_observed"
					: "inconclusive";
	const outcome: DastOutcome =
		verdict === "findings"
			? "findings"
			: verdict === "no_findings_observed"
				? "passed"
				: "inconclusive";

	return {
		coverageStatus,
		coverageSummary,
		verdict,
		outcome,
		limitationCodes,
	};
}
