export function preferredStartPlans<T extends { pluginId: string }>(
	plans: readonly T[],
): T[] {
	if (plans.length === 0) return [];
	const highestPriority = Math.max(
		...plans.map((plan) => startPlanPriority(plan.pluginId)),
	);
	return plans
		.filter((plan) => startPlanPriority(plan.pluginId) === highestPriority)
		.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

export function startPlanPriority(pluginId: string): number {
	return pluginId.startsWith("framework.") ? 200 : 100;
}
