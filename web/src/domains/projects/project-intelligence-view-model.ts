import type { DiagnosticEvidenceGraph } from "../../../../shared/schemas/static-intelligence.schema";
import type { ProjectIntelligenceSummary } from "../../api";

export type ProjectCardSummary = {
	riskBand: string;
	evidenceQuality: string;
	findingCount: number;
	codeStructureStatus: string;
	scanStatus: string;
	hasDegradedReasons: boolean;
};

export function buildProjectCardSummary(
	overview: ProjectIntelligenceSummary | null | undefined,
): ProjectCardSummary {
	return {
		riskBand: overview?.riskBand ?? "none",
		evidenceQuality: overview?.evidenceQuality ?? "missing",
		findingCount: overview?.findingCount ?? 0,
		codeStructureStatus: overview?.codeStructureStatus ?? "missing",
		scanStatus: overview?.scanStatus ?? "none",
		hasDegradedReasons: (overview?.degradedReasonCount ?? 0) > 0,
	};
}

export function countGraphKinds(graph: DiagnosticEvidenceGraph): {
	nodeCounts: Record<string, number>;
	edgeCounts: Record<string, number>;
} {
	return {
		nodeCounts: countBy(graph.nodes, (node) => node.kind),
		edgeCounts: countBy(graph.edges, (edge) => edge.kind),
	};
}

function countBy<T>(
	items: T[],
	pick: (item: T) => string,
): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = pick(item);
		acc[key] = (acc[key] ?? 0) + 1;
		return acc;
	}, {});
}
