import type { StaticIntelligenceOntologyHandoff } from "../../../shared/schemas/static-intelligence-module.schema";
import { staticIntelligenceOntologyHandoffSchema } from "../../../shared/schemas/static-intelligence-module.schema";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository";
import { buildStaticIntelligenceModuleCandidates } from "./module-candidates";

export function buildStaticIntelligenceOntologyHandoff(params: {
	generation: PersistedStaticIntelligenceGeneration;
	status?: StaticIntelligenceOntologyHandoff["status"];
	degradedReasons?: string[];
}): StaticIntelligenceOntologyHandoff {
	const { generation } = params;
	const snapshotRef = generation.structure.metadata.snapshotRef;
	const exportHash = generation.export.metadata.exportHash;
	if (!snapshotRef || !exportHash) {
		throw new Error("Persisted generation provenance is incomplete.");
	}
	const modules = buildStaticIntelligenceModuleCandidates({
		snapshot: generation.structure.snapshot,
		exportPayload: generation.export.payload,
	});
	const degradedReasons = uniqueSorted([
		...generation.structure.metadata.degradedReasons,
		...(params.degradedReasons ?? []),
		...(modules.length === 0 ? ["module_candidates_missing"] : []),
	]);
	return staticIntelligenceOntologyHandoffSchema.parse({
		status:
			params.status === "failed" || params.status === "stale"
				? params.status
				: degradedReasons.length > 0
					? "degraded"
					: (params.status ?? generation.status),
		projectId: generation.projectId,
		scanRunId: generation.scanRunId,
		generationId: generation.generationId,
		snapshotRef,
		exportHash,
		sourceTreeHash: generation.structure.metadata.sourceTreeHash,
		modules,
		graphSummary: {
			nodeCounts: countBy(
				generation.export.payload.graph.nodes.map((node) => node.kind),
			),
			edgeCounts: countBy(
				generation.export.payload.graph.edges.map((edge) => edge.kind),
			),
		},
		verificationCommands:
			generation.export.payload.handoff?.verificationCommands ?? [],
		sourceRefs: uniqueSorted([
			`project:${generation.projectId}`,
			`scan:${generation.scanRunId}`,
			`snapshot:${snapshotRef}`,
			...generation.export.payload.fileRiskIndex.flatMap((entry) => [
				...entry.findingIds.map((id) => `finding:${id}`),
				...entry.evidenceRefs.map((id) => withRefKind("evidence", id)),
				`file:${entry.path}`,
			]),
		]),
		degradedReasons,
		consumerBoundary: {
			ownsCanonicalOntology: false,
			ownsTaskCompilation: false,
			consumer: "NightWorkers",
		},
	});
}

function withRefKind(kind: string, value: string): string {
	return value.startsWith(`${kind}:`) ? value : `${kind}:${value}`;
}

function countBy(values: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	return counts;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
