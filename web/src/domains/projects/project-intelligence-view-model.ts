import type { DiagnosticEvidenceGraph } from "../../../../shared/schemas/static-intelligence.schema";
import type { ProjectIntelligenceOverview } from "../../api";

export type ProjectCardSummary = {
	riskBand: string;
	evidenceQuality: string;
	findingCount: number;
	codeStructureStatus: string;
	scanStatus: string;
	hasDegradedReasons: boolean;
};

export function buildProjectCardSummary(
	overview: ProjectIntelligenceOverview | null | undefined,
): ProjectCardSummary {
	return {
		riskBand: overview?.latestExport?.scanSummary.riskBand ?? "none",
		evidenceQuality:
			overview?.latestExport?.scanSummary.evidenceQuality ?? "missing",
		findingCount: overview?.latestExport?.scan.findingCount ?? 0,
		codeStructureStatus: overview?.availability.codeStructure ?? "missing",
		scanStatus: overview?.latestScan?.status ?? "none",
		hasDegradedReasons: (overview?.degradedReasons.length ?? 0) > 0,
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
