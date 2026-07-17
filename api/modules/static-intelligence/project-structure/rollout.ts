export const PROJECT_STRUCTURE_ROLLOUT_MODES = [
	"v1",
	"dual",
	"v2_preferred",
] as const;

export type ProjectStructureRolloutMode =
	(typeof PROJECT_STRUCTURE_ROLLOUT_MODES)[number];

/**
 * Server-owned rollout switch. Invalid values fail closed to dual-write so a
 * configuration typo never drops the established v1 compatibility artifact.
 */
export function projectStructureRolloutMode(
	value = process.env.PROJECT_STRUCTURE_SCANNER_MODE ??
		process.env.STATIC_INTELLIGENCE_PROJECT_STRUCTURE_MODE,
): ProjectStructureRolloutMode {
	if (value === "v2") return "v2_preferred";
	return PROJECT_STRUCTURE_ROLLOUT_MODES.includes(
		value as ProjectStructureRolloutMode,
	)
		? (value as ProjectStructureRolloutMode)
		: "dual";
}

export function emitProjectStructureComparisonTelemetry(input: {
	mode: ProjectStructureRolloutMode;
	durationMs: number;
	v1FileCount: number;
	v2FileCount: number;
	v2ResolvedCount: number;
	v2UnresolvedCount: number;
	diagnosticCodes: string[];
}): void {
	const diagnosticCounts: Record<string, number> = {};
	for (const code of input.diagnosticCodes) {
		diagnosticCounts[code] = (diagnosticCounts[code] ?? 0) + 1;
	}
	console.error(
		JSON.stringify({
			type: "project_structure_comparison",
			mode: input.mode,
			durationMs: input.durationMs,
			v1FileCount: input.v1FileCount,
			v2FileCount: input.v2FileCount,
			v2ResolvedCount: input.v2ResolvedCount,
			v2UnresolvedCount: input.v2UnresolvedCount,
			diagnosticCounts,
		}),
	);
}

export function shouldPersistProjectStructure(
	mode: ProjectStructureRolloutMode,
): boolean {
	return mode !== "v1";
}

export function shouldPreferProjectStructureV2(
	mode: ProjectStructureRolloutMode,
): boolean {
	return mode === "v2_preferred";
}
