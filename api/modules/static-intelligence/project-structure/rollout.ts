export function emitProjectStructureComparisonTelemetry(input: {
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
			durationMs: input.durationMs,
			v1FileCount: input.v1FileCount,
			v2FileCount: input.v2FileCount,
			v2ResolvedCount: input.v2ResolvedCount,
			v2UnresolvedCount: input.v2UnresolvedCount,
			diagnosticCounts,
		}),
	);
}
