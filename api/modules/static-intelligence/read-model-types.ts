import type { StaticIntelligenceKnowledgeSourceManifest } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type {
	IntelligenceReadinessStatus,
	StaticIntelligenceReadiness,
} from "../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectRepository, ScanRepository } from "../scans/repositories";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository";

export type ProjectRow = NonNullable<
	Awaited<ReturnType<ProjectRepository["findById"]>>
>;
export type ScanRow = NonNullable<
	Awaited<ReturnType<ScanRepository["findById"]>>
>;
export type ProjectIntelligenceSelection = {
	requestedScanRunId: string | null;
	selectedScanRunId: string | null;
	isLatest: boolean;
	selectionReason:
		| "requested"
		| "latest_completed"
		| "latest_terminal_degraded"
		| "none";
};
export type ScanSelection = {
	latestUsableScan: ScanRow | null;
	selectedScan: ScanRow | null;
	selection: ProjectIntelligenceSelection;
};

export type ProjectIntelligenceProject = {
	id: string;
	name: string;
	repositoryName: string;
	defaultBranch: string;
	createdAt: Date;
	updatedAt: Date;
};

export type ProjectIntelligenceView = {
	project: ProjectIntelligenceProject;
	latestUsableScan: ScanRow | null;
	selectedScan: ScanRow | null;
	selection: ProjectIntelligenceSelection;
	generation: {
		generationId: string;
		generatedAt: string;
		sourceTreeHash: string;
		sourceStateHash: string;
		snapshotRef?: string;
		exportHash: string;
		status: IntelligenceReadinessStatus;
	} | null;
	export: PersistedStaticIntelligenceGeneration["export"]["payload"] | null;
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
