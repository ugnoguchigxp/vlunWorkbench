import type { StaticIntelligenceExportV1 } from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceModuleCandidate } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectStructureSummaryResponse } from "../../api";

export type ModuleFilters = {
	query: string;
	confidence: "all" | "high" | "medium" | "low";
	riskOnly: boolean;
};

export type ModuleRelationshipContext = {
	module: StaticIntelligenceModuleCandidate;
	inbound: StaticIntelligenceModuleCandidate[];
	outbound: StaticIntelligenceModuleCandidate[];
	unresolvedOutbound: string[];
};

export type StructureMetrics = {
	inventoryFiles: number | null;
	analyzedFiles: number | null;
	modules: number;
	resolvedReferences: number | null;
	unresolvedReferences: number | null;
	entrypoints: number;
	packages: number;
	findings: number;
};

export function sortModuleCandidates(
	modules: readonly StaticIntelligenceModuleCandidate[],
): StaticIntelligenceModuleCandidate[] {
	return [...modules].sort(
		(a, b) =>
			b.fileCount - a.fileCount || a.pathPrefix.localeCompare(b.pathPrefix),
	);
}

export function confidenceBand(
	confidence: number,
): Exclude<ModuleFilters["confidence"], "all"> {
	if (confidence >= 0.85) return "high";
	if (confidence >= 0.7) return "medium";
	return "low";
}

export function filterModuleCandidates(
	modules: readonly StaticIntelligenceModuleCandidate[],
	filters: ModuleFilters,
): StaticIntelligenceModuleCandidate[] {
	const query = filters.query.trim().toLowerCase();
	return sortModuleCandidates(modules).filter((module) => {
		if (
			filters.confidence !== "all" &&
			confidenceBand(module.confidence) !== filters.confidence
		)
			return false;
		if (filters.riskOnly && module.risk.findingCount === 0) return false;
		if (!query) return true;
		return [
			module.label,
			module.pathPrefix,
			...module.roleTags,
			...module.entrypointFiles,
			...module.internalDependencies,
			...module.packageDependencies,
		]
			.join("\n")
			.toLowerCase()
			.includes(query);
	});
}

export function resolveSelectedModule(
	modules: readonly StaticIntelligenceModuleCandidate[],
	requestedModuleId: string | null,
): StaticIntelligenceModuleCandidate | null {
	return (
		modules.find((module) => module.id === requestedModuleId) ??
		sortModuleCandidates(modules)[0] ??
		null
	);
}

export function buildModuleRelationshipContext(
	modules: readonly StaticIntelligenceModuleCandidate[],
	moduleId: string,
): ModuleRelationshipContext | null {
	const selected = modules.find((module) => module.id === moduleId);
	if (!selected) return null;
	const byPathPrefix = new Map(
		modules.map((module) => [module.pathPrefix, module]),
	);
	const outbound: StaticIntelligenceModuleCandidate[] = [];
	const unresolvedOutbound: string[] = [];
	for (const dependency of selected.internalDependencies) {
		const target = byPathPrefix.get(dependency);
		if (target) outbound.push(target);
		else unresolvedOutbound.push(dependency);
	}
	const inbound = modules.filter(
		(module) =>
			module.id !== selected.id &&
			module.internalDependencies.includes(selected.pathPrefix),
	);
	return {
		module: selected,
		inbound: sortModuleCandidates(inbound),
		outbound: sortModuleCandidates(outbound),
		unresolvedOutbound: [...new Set(unresolvedOutbound)].sort(),
	};
}

export function buildStructureMetrics(
	structure: ProjectStructureSummaryResponse | null,
	exportPayload: StaticIntelligenceExportV1,
): StructureMetrics {
	const modules = structure?.modules ?? [];
	return {
		inventoryFiles: structure?.coverage?.includedFileCount ?? null,
		analyzedFiles: structure?.summary?.analyzedFileCount ?? null,
		modules: modules.length,
		resolvedReferences: structure?.summary?.resolvedReferenceCount ?? null,
		unresolvedReferences: structure?.summary?.unresolvedReferenceCount ?? null,
		entrypoints: modules.reduce(
			(count, module) => count + module.entrypointFiles.length,
			0,
		),
		packages: new Set(modules.flatMap((module) => module.packageDependencies))
			.size,
		findings: exportPayload.scan.findingCount,
	};
}

export function countGraphItems(exportPayload: StaticIntelligenceExportV1): {
	nodes: Record<string, number>;
	edges: Record<string, number>;
} {
	const nodes: Record<string, number> = {};
	const edges: Record<string, number> = {};
	for (const node of exportPayload.graph.nodes)
		nodes[node.kind] = (nodes[node.kind] ?? 0) + 1;
	for (const edge of exportPayload.graph.edges)
		edges[edge.kind] = (edges[edge.kind] ?? 0) + 1;
	return { nodes, edges };
}
