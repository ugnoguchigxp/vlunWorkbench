export type MeasurementAssessment = {
	status: "completed" | "incomplete" | "not_executed";
	reason: string | null;
};

export function assessJuiceShopMeasurement(metrics: {
	executedScenarioCount?: number;
	eligibleScenarioCount?: number;
}): MeasurementAssessment {
	const executed = metrics.executedScenarioCount ?? 0;
	const eligible = metrics.eligibleScenarioCount ?? 0;
	if (executed === 0) {
		return { status: "not_executed", reason: "observations_missing" };
	}
	if (eligible <= 0 || executed < eligible) {
		return {
			status: "incomplete",
			reason: "scenario_observations_incomplete",
		};
	}
	return { status: "completed", reason: null };
}
