import path from "node:path";
import type {
	IntelligenceReadinessStatus,
	StaticIntelligenceReadiness,
} from "../../../shared/schemas/static-intelligence-module.schema";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository";
import type {
	ProjectIntelligenceProject,
	ProjectIntelligenceView,
	ProjectRow,
	ScanRow,
	ScanSelection,
} from "./read-model-types";

export const missingReadiness = (
	reason: string,
): StaticIntelligenceReadiness => {
	const item = { status: "missing" as const, reasonCodes: [reason] };
	return {
		export: item,
		fileRiskIndex: item,
		evidenceGraph: item,
		codeStructure: item,
		semanticIndex: item,
		agentBundle: item,
		ontologyHandoff: item,
	};
};

export function emptyIntelligenceView(
	project: ProjectRow,
	selection: ScanSelection,
): ProjectIntelligenceView {
	return {
		project: toProjectIntelligenceProject(project),
		latestUsableScan: null,
		selectedScan: null,
		selection: selection.selection,
		generation: null,
		export: null,
		manifest: null,
		readiness: missingReadiness("scan_missing"),
		degradedReasons: ["scan_missing"],
	};
}

export function missingGenerationView(
	project: ProjectRow,
	selection: ScanSelection,
): ProjectIntelligenceView {
	return {
		project: toProjectIntelligenceProject(project),
		latestUsableScan: selection.latestUsableScan,
		selectedScan: selection.selectedScan,
		selection: selection.selection,
		generation: null,
		export: null,
		manifest: null,
		readiness: missingReadiness("generation_missing"),
		degradedReasons: ["generation_missing"],
	};
}

export function failedGenerationView(
	project: ProjectRow,
	selection: ScanSelection,
): ProjectIntelligenceView {
	const item = {
		status: "failed" as const,
		reasonCodes: ["generation_invalid"],
	};
	return {
		project: toProjectIntelligenceProject(project),
		latestUsableScan: selection.latestUsableScan,
		selectedScan: selection.selectedScan,
		selection: selection.selection,
		generation: null,
		export: null,
		manifest: null,
		readiness: {
			export: item,
			fileRiskIndex: item,
			evidenceGraph: item,
			codeStructure: item,
			semanticIndex: item,
			agentBundle: item,
			ontologyHandoff: item,
		},
		degradedReasons: ["generation_invalid"],
	};
}

export function toProjectIntelligenceProject(
	project: ProjectRow,
): ProjectIntelligenceProject {
	const normalized = project.repoPath.replaceAll("\\", "/").replace(/\/+$/, "");
	return {
		id: project.id,
		name: project.name,
		repositoryName: path.posix.basename(normalized) || project.name,
		defaultBranch: project.defaultBranch,
		createdAt: project.createdAt,
		updatedAt: project.updatedAt,
	};
}

export function generationSummary(
	generation: PersistedStaticIntelligenceGeneration,
	status: IntelligenceReadinessStatus,
) {
	const exportHash = generation.export.metadata.exportHash;
	if (!exportHash) throw new Error("Generation export provenance missing.");
	return {
		generationId: generation.generationId,
		generatedAt: generation.structure.metadata.generatedAt,
		sourceTreeHash: generation.structure.metadata.sourceTreeHash,
		sourceStateHash: generation.structure.metadata.sourceStateHash,
		snapshotRef: generation.structure.metadata.snapshotRef,
		exportHash,
		status,
	};
}

export function compareScansNewestFirst(left: ScanRow, right: ScanRow): number {
	return scanTime(right) - scanTime(left);
}

function scanTime(scan: ScanRow): number {
	return (scan.completedAt ?? scan.createdAt).getTime();
}

export function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}
