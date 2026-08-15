export type MeasurementAssessment = {
	status:
		| "completed"
		| "incomplete"
		| "not_executed"
		| "blocked"
		| "failed_cleanup";
	reason: string | null;
};

export function assessJuiceShopMeasurement(metrics: {
	executedScenarioCount?: number;
	eligibleScenarioCount?: number;
	observationCount?: number;
	blockedScenarioCount?: number;
	inconclusiveScenarioCount?: number;
	failedCleanupScenarioCount?: number;
}): MeasurementAssessment {
	const executed = metrics.executedScenarioCount ?? 0;
	const eligible = metrics.eligibleScenarioCount ?? 0;
	const observed = metrics.observationCount ?? executed;
	const blocked = metrics.blockedScenarioCount ?? 0;
	const inconclusive = metrics.inconclusiveScenarioCount ?? 0;
	const failedCleanup = metrics.failedCleanupScenarioCount ?? 0;
	if (failedCleanup > 0) {
		return {
			status: "failed_cleanup",
			reason: "scenario_cleanup_failed",
		};
	}
	if (blocked > 0 && executed === 0 && inconclusive === 0) {
		return { status: "blocked", reason: "scenario_dependencies_blocked" };
	}
	if (observed === 0) {
		return { status: "not_executed", reason: "observations_missing" };
	}
	if (eligible <= 0 || executed < eligible || blocked > 0 || inconclusive > 0) {
		return {
			status: "incomplete",
			reason:
				blocked > 0
					? "scenario_dependencies_blocked"
					: inconclusive > 0
						? "scenario_observations_inconclusive"
						: "scenario_observations_incomplete",
		};
	}
	return { status: "completed", reason: null };
}
