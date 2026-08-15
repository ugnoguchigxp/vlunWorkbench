export type WorkloadObservation = {
	id: string;
	durationsMs: number[];
	operations: number;
	elapsedMs: number;
	maxQueueDepth: number;
	errors: number;
	rejections: number;
};

export type WorkloadSummary = {
	id: string;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
	throughputPerSecond: number;
	maxQueueDepth: number;
	errors: number;
	rejections: number;
};

export function classifyGitSourceState(
	exitCode: number,
	statusOutput: string,
): "clean" | "dirty" | "unknown" {
	if (exitCode !== 0) return "unknown";
	return statusOutput.trim() ? "dirty" : "clean";
}

export function percentile(values: readonly number[], value: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((value / 100) * sorted.length) - 1),
	);
	return sorted[index] ?? 0;
}

export const median = (values: readonly number[]): number =>
	percentile(values, 50);

export function summarizeObservation(
	observation: WorkloadObservation,
): WorkloadSummary {
	return {
		id: observation.id,
		p50Ms: percentile(observation.durationsMs, 50),
		p95Ms: percentile(observation.durationsMs, 95),
		p99Ms: percentile(observation.durationsMs, 99),
		throughputPerSecond:
			observation.elapsedMs === 0
				? 0
				: (observation.operations / observation.elapsedMs) * 1_000,
		maxQueueDepth: observation.maxQueueDepth,
		errors: observation.errors,
		rejections: observation.rejections,
	};
}

export function medianSummary(
	id: string,
	runs: readonly WorkloadSummary[],
): WorkloadSummary {
	return {
		id,
		p50Ms: median(runs.map((run) => run.p50Ms)),
		p95Ms: median(runs.map((run) => run.p95Ms)),
		p99Ms: median(runs.map((run) => run.p99Ms)),
		throughputPerSecond: median(runs.map((run) => run.throughputPerSecond)),
		maxQueueDepth: Math.max(...runs.map((run) => run.maxQueueDepth)),
		errors: runs.reduce((sum, run) => sum + run.errors, 0),
		rejections: runs.reduce((sum, run) => sum + run.rejections, 0),
	};
}

export async function measure<T>(
	operation: () => T | Promise<T>,
): Promise<{ durationMs: number; value: T }> {
	const startedAt = performance.now();
	const value = await operation();
	return { durationMs: performance.now() - startedAt, value };
}
