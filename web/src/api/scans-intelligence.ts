import type {
	ProjectStructureCoverage,
	ProjectStructureDiagnostic,
	ProjectStructureSnapshotV2,
} from "../../../shared/schemas/project-structure.schema";
import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceAgentQueryKind,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type { StaticIntelligenceKnowledgeSourceManifest } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type {
	IntelligenceReadinessStatus,
	StaticIntelligenceModuleCandidate,
	StaticIntelligenceOntologyHandoff,
	StaticIntelligenceReadiness,
} from "../../../shared/schemas/static-intelligence-module.schema";
import { requestJson } from "./core";
import type { ScanRun } from "./scans";

export type ProjectIntelligenceView = {
	project: ProjectIntelligenceProject;
	latestUsableScan: ScanRun | null;
	selectedScan: ScanRun | null;
	selection: {
		requestedScanRunId: string | null;
		selectedScanRunId: string | null;
		isLatest: boolean;
		selectionReason:
			| "requested"
			| "latest_completed"
			| "latest_terminal_degraded"
			| "none";
	};
	generation: {
		generationId: string;
		generatedAt: string;
		sourceTreeHash: string;
		sourceStateHash: string;
		snapshotRef?: string;
		exportHash: string;
		status: IntelligenceReadinessStatus;
	} | null;
	export: StaticIntelligenceExportV1 | null;
	manifest: StaticIntelligenceKnowledgeSourceManifest | null;
	readiness: StaticIntelligenceReadiness;
	degradedReasons: string[];
};

export type ProjectIntelligenceSummary = {
	project: ProjectIntelligenceProject;
	projectId: string;
	selectedScanRunId: string | null;
	scanStatus: string | null;
	riskBand: string;
	evidenceQuality: string;
	findingCount: number;
	codeStructureStatus: IntelligenceReadinessStatus;
	generationStatus: IntelligenceReadinessStatus;
	generatedAt: string | null;
	degradedReasonCount: number;
};

export type ProjectIntelligenceProject = {
	id: string;
	name: string;
	repositoryName: string;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
};

export type ProjectStructureListResponse = {
	status: IntelligenceReadinessStatus | "available" | "degraded";
	generationId?: string;
	items: Array<{
		path: string;
		language: string;
		moduleKind: string;
		tags: string[];
		analysisStatus: string;
		referenceCount: number;
		exportCount: number;
		externalDependencyCount: number;
		risk: FileRiskIndexEntry | null;
	}>;
	modules: StaticIntelligenceModuleCandidate[];
	nextCursor: number | null;
	total?: number;
	summary?: ProjectStructureSnapshotV2["summary"];
	coverage?: ProjectStructureCoverage;
	readiness?: ProjectStructureSnapshotV2["readiness"];
	diagnostics?: ProjectStructureDiagnostic[];
};

export type ScanIntelligenceExportResponse = {
	export: StaticIntelligenceExportV1;
};

export type ScanIntelligenceAgentMode =
	| "overview"
	| "risk"
	| "evidence"
	| "verification"
	| "export";

export type ScanIntelligenceAgentQueryResponse = {
	result: StaticIntelligenceAgentQueryResult;
};

export const agentModeToQueryKind: Record<
	ScanIntelligenceAgentMode,
	StaticIntelligenceAgentQueryKind
> = {
	overview: "project_overview",
	risk: "risk_context",
	evidence: "evidence_bundle",
	verification: "verification_commands",
	export: "export_static_intelligence",
};

export async function fetchProjectIntelligenceView(
	projectId: string,
	scanRunId?: string | null,
): Promise<ProjectIntelligenceView> {
	const search = new URLSearchParams();
	if (scanRunId) search.set("scanRunId", scanRunId);
	return requestJson<ProjectIntelligenceView>(
		`/api/projects/${projectId}/intelligence${search.size ? `?${search.toString()}` : ""}`,
	);
}

export async function fetchProjectIntelligenceSummaries(): Promise<
	ProjectIntelligenceSummary[]
> {
	const data = await requestJson<{ summaries: ProjectIntelligenceSummary[] }>(
		"/api/projects/intelligence-summaries",
	);
	return data.summaries;
}

export async function fetchProjectStructure(
	projectId: string,
	scanRunId: string,
	params: {
		generationId?: string;
		query?: string;
		analyzerId?: string;
		kind?: string;
		status?: string;
		cursor?: number;
		limit?: number;
	} = {},
): Promise<ProjectStructureListResponse> {
	const search = new URLSearchParams({ scanRunId, view: "files" });
	for (const [key, value] of Object.entries(params))
		if (value !== undefined && value !== "") search.set(key, String(value));
	return requestJson<ProjectStructureListResponse>(
		`/api/projects/${projectId}/intelligence/project-structure?${search.toString()}`,
	);
}

export async function fetchProjectOntologyHandoff(
	projectId: string,
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceOntologyHandoff | null> {
	const data = await requestJson<{
		handoff: StaticIntelligenceOntologyHandoff | null;
	}>(
		`/api/projects/${projectId}/intelligence/ontology-handoff?${new URLSearchParams(
			{
				scanRunId,
				...(generationId ? { generationId } : {}),
			},
		).toString()}`,
	);
	return data.handoff;
}

export async function refreshProjectIntelligence(
	projectId: string,
	scanRunId: string,
	includeSemantic = false,
): Promise<{ ok: true; status: "completed" | "partial" }> {
	return requestJson(`/api/projects/${projectId}/intelligence/refresh`, {
		method: "POST",
		body: { scanRunId, includeSemantic },
	});
}

export async function fetchScanIntelligenceExport(
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceExportV1> {
	const search = generationId
		? `?${new URLSearchParams({ generationId }).toString()}`
		: "";
	const data = await requestJson<ScanIntelligenceExportResponse>(
		`/api/scans/${scanRunId}/intelligence/export${search}`,
	);
	return data.export;
}

export async function fetchScanIntelligenceAgentQuery(
	scanRunId: string,
	params: {
		mode: ScanIntelligenceAgentMode;
		generationId?: string;
		query?: string;
		findingId?: string;
		file?: string;
		ruleId?: string;
		scanner?: string;
	},
): Promise<StaticIntelligenceAgentQueryResult> {
	const search = new URLSearchParams({ mode: params.mode });
	for (const key of [
		"generationId",
		"query",
		"findingId",
		"file",
		"ruleId",
		"scanner",
	] as const) {
		const value = params[key];
		if (value) search.set(key, value);
	}
	const data = await requestJson<ScanIntelligenceAgentQueryResponse>(
		`/api/scans/${scanRunId}/intelligence/agent-query?${search.toString()}`,
	);
	return data.result;
}
