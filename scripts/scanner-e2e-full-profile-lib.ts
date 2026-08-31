/** Fields that are deterministic across two executions of the same profile. */
export function normalizedFullProfileRun(run: {
	profileOutcome: string;
	executionPlanHash: string;
	sourceRevisionHash: string;
	steps: unknown;
	scannerProcessCount: number;
	runtimeRequestCount: number;
	normalizedFindingHashes: string[];
	toolVersions: Record<string, string>;
	artifacts: Array<{ kind: string }>;
	canonicalFinalReportCount: number;
	targetStartCount: number;
	activeTargetCountAfterRun: number;
}) {
	return {
		profileOutcome: run.profileOutcome,
		executionPlanHash: run.executionPlanHash,
		sourceRevisionHash: run.sourceRevisionHash,
		steps: run.steps,
		scannerProcessCount: run.scannerProcessCount,
		runtimeRequestCount: run.runtimeRequestCount,
		normalizedFindingHashes: run.normalizedFindingHashes,
		toolVersions: Object.fromEntries(
			Object.entries(run.toolVersions).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
		artifactRoles: run.artifacts.map((artifact) => artifact.kind).sort(),
		canonicalFinalReportCount: run.canonicalFinalReportCount,
		targetStartCount: run.targetStartCount,
		activeTargetCountAfterRun: run.activeTargetCountAfterRun,
	};
}
