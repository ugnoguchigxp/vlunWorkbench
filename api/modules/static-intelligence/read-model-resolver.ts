import type { AppDatabase } from "../../db";
import type { ProjectRepository, ScanRepository } from "../scans/repositories";
import { isTemporaryProjectPath } from "../scans/project-visibility";
import { StaticIntelligenceEmbeddingRepository } from "./embedding-repository";
import { buildStaticIntelligenceEmbeddingSources } from "./embedding-source-builder";
import {
	type PersistedStaticIntelligenceGeneration,
	StaticIntelligenceGenerationRepository,
	StaticIntelligenceGenerationValidationError,
} from "./generation-repository";
import { buildSourceStateHash } from "./generation-types";
import { buildStaticIntelligenceOntologyHandoff } from "./ontology-handoff";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import { probeSourceRevision } from "./build-service";
import { StaticIntelligenceRepository } from "./repository";
import type { StaticIntelligenceSourceBundle } from "./types";
import type {
	IntelligenceCapabilityReadiness,
	IntelligenceReadinessStatus,
	StaticIntelligenceReadiness,
} from "../../../shared/schemas/static-intelligence-module.schema";
import type {
	ProjectIntelligenceSummary,
	ProjectIntelligenceView,
	ProjectRow,
	ScanRow,
	ScanSelection,
} from "./read-model-types";
import {
	compareScansNewestFirst,
	emptyIntelligenceView,
	failedGenerationView,
	generationSummary,
	missingGenerationView,
	toProjectIntelligenceProject,
	uniqueSorted,
} from "./read-model-views";

export type {
	ProjectIntelligenceProject,
	ProjectIntelligenceSummary,
	ProjectIntelligenceView,
} from "./read-model-types";

export class StaticIntelligenceSelectionNotFoundError extends Error {}

export class StaticIntelligenceReadModelResolver {
	private readonly generations: StaticIntelligenceGenerationRepository;
	private readonly sources: StaticIntelligenceRepository;
	private readonly embeddings: StaticIntelligenceEmbeddingRepository;

	constructor(
		db: AppDatabase,
		private readonly projectRepository: ProjectRepository,
		private readonly scanRepository: ScanRepository,
		generationRepository?: StaticIntelligenceGenerationRepository,
		sourceRepository?: StaticIntelligenceRepository,
	) {
		this.generations =
			generationRepository ?? new StaticIntelligenceGenerationRepository(db);
		this.sources = sourceRepository ?? new StaticIntelligenceRepository(db);
		this.embeddings = new StaticIntelligenceEmbeddingRepository(db);
	}

	async resolveView(params: {
		project: ProjectRow;
		requestedScanRunId?: string | null;
		probeFilesystem?: boolean;
	}): Promise<ProjectIntelligenceView> {
		const scans = await this.scanRepository.listScanRunsByProject(
			params.project.id,
		);
		const selection = await this.selectScan(
			params.project.id,
			scans,
			params.requestedScanRunId ?? null,
		);
		if (!selection.selectedScan)
			return emptyIntelligenceView(params.project, selection);

		let generation: PersistedStaticIntelligenceGeneration | null = null;
		try {
			generation = await this.generations.loadLatestValidGeneration(
				selection.selectedScan.id,
			);
		} catch {
			return failedGenerationView(params.project, selection);
		}
		if (!generation) {
			return (await this.generations.hasDerivedArtifacts(
				selection.selectedScan.id,
			))
				? failedGenerationView(params.project, selection)
				: missingGenerationView(params.project, selection);
		}

		const readiness = await this.resolveReadiness(
			params.project,
			generation,
			params.probeFilesystem ?? true,
		);
		const degradedReasons = uniqueSorted([
			...generation.structure.metadata.degradedReasons,
			...readiness.export.reasonCodes,
			...readiness.codeStructure.reasonCodes,
		]);
		return {
			project: toProjectIntelligenceProject(params.project),
			latestUsableScan: selection.latestUsableScan,
			selectedScan: selection.selectedScan,
			selection: selection.selection,
			generation: generationSummary(generation, readiness.export.status),
			export: generation.export.payload,
			manifest: buildStaticIntelligenceKnowledgeSourceManifest(
				generation.export.payload,
				{ generation, readiness },
			),
			readiness,
			degradedReasons,
		};
	}

	async resolveGeneration(scanRunId: string, generationId?: string | null) {
		try {
			return generationId
				? await this.generations.loadGeneration(scanRunId, generationId)
				: await this.generations.loadLatestValidGeneration(scanRunId);
		} catch (error) {
			if (error instanceof StaticIntelligenceGenerationValidationError)
				return null;
			throw error;
		}
	}

	async resolveReadiness(
		project: ProjectRow,
		generation: PersistedStaticIntelligenceGeneration,
		probeFilesystem = true,
	): Promise<StaticIntelligenceReadiness> {
		const bundle = await this.sources.loadSourceBundle(generation.scanRunId);
		const freshness = this.resolveFreshness(
			project,
			generation,
			probeFilesystem,
			bundle,
		);
		const semantic = await this.resolveSemanticReadiness(generation, bundle);
		return readinessForGeneration(generation, freshness, semantic);
	}

	async listSummaries(
		ownerUserId: string,
	): Promise<ProjectIntelligenceSummary[]> {
		const projects = (
			await this.projectRepository.listProjects(ownerUserId)
		).filter((project) => !isTemporaryProjectPath(project.repoPath));
		return await Promise.all(
			projects.map(async (project) => {
				const view = await this.resolveView({
					project,
					probeFilesystem: false,
				});
				return {
					project: toProjectIntelligenceProject(project),
					projectId: project.id,
					selectedScanRunId: view.selectedScan?.id ?? null,
					scanStatus: view.selectedScan?.status ?? null,
					riskBand: view.export?.scanSummary.riskBand ?? "none",
					evidenceQuality:
						view.export?.scanSummary.evidenceQuality ?? "missing",
					findingCount: view.export?.scan.findingCount ?? 0,
					codeStructureStatus: view.readiness.codeStructure.status,
					generationStatus: view.readiness.export.status,
					generatedAt: view.generation?.generatedAt ?? null,
					degradedReasonCount: view.degradedReasons.length,
				};
			}),
		);
	}

	async ontologyHandoff(params: {
		scanRunId: string;
		generationId?: string | null;
		status?: IntelligenceReadinessStatus;
	}) {
		const generation = await this.resolveGeneration(
			params.scanRunId,
			params.generationId,
		);
		return generation
			? buildStaticIntelligenceOntologyHandoff({
					generation,
					status: params.status,
				})
			: null;
	}

	private async selectScan(
		projectId: string,
		scans: ScanRow[],
		requestedScanRunId: string | null,
	): Promise<ScanSelection> {
		const sorted = [...scans].sort(compareScansNewestFirst);
		const latestCompleted =
			sorted.find((scan) => scan.status === "completed") ?? null;
		let latestTerminal: ScanRow | null = null;
		if (!latestCompleted) {
			for (const scan of sorted.filter((item) =>
				["failed", "cancelled"].includes(item.status),
			)) {
				if (await this.hasTerminalEvidence(scan.id)) {
					latestTerminal = scan;
					break;
				}
			}
		}
		const latestUsableScan = latestCompleted ?? latestTerminal;
		let selectedScan = latestUsableScan;
		let selectionReason: ProjectIntelligenceView["selection"]["selectionReason"] =
			latestCompleted
				? "latest_completed"
				: latestTerminal
					? "latest_terminal_degraded"
					: "none";
		if (requestedScanRunId) {
			const requested = await this.scanRepository.findById(requestedScanRunId);
			if (!requested || requested.projectId !== projectId) {
				throw new StaticIntelligenceSelectionNotFoundError(
					"Scan run not found",
				);
			}
			selectedScan = requested;
			selectionReason = "requested";
		}
		return {
			latestUsableScan,
			selectedScan,
			selection: {
				requestedScanRunId,
				selectedScanRunId: selectedScan?.id ?? null,
				isLatest: Boolean(
					selectedScan && selectedScan.id === latestUsableScan?.id,
				),
				selectionReason,
			},
		};
	}

	private async hasTerminalEvidence(scanRunId: string): Promise<boolean> {
		const bundle = await this.sources.loadSourceBundle(scanRunId);
		return Boolean(
			bundle &&
				(bundle.findings.length > 0 ||
					bundle.artifacts.length > 0 ||
					bundle.latestReview),
		);
	}

	private resolveFreshness(
		project: ProjectRow,
		generation: PersistedStaticIntelligenceGeneration,
		probeFilesystem: boolean,
		bundle: StaticIntelligenceSourceBundle | null,
	): { status: IntelligenceReadinessStatus; reasons: string[] } {
		if (!bundle)
			return { status: "failed", reasons: ["source_state_unavailable"] };
		if (
			buildSourceStateHash(bundle) !==
			generation.export.metadata.sourceStateHash
		) {
			return { status: "stale", reasons: ["source_state_changed"] };
		}
		if (!probeFilesystem) {
			return { status: "available", reasons: [] };
		}
		const persistedRevision = generation.structure.metadata.sourceRevision;
		if (persistedRevision.kind !== "git") {
			return { status: "degraded", reasons: ["source_revision_unavailable"] };
		}
		const current = probeSourceRevision(
			project.repoPath,
			generation.structure.metadata.sourceTreeHash,
		);
		if (current.kind !== "git") {
			return { status: "degraded", reasons: ["source_revision_unavailable"] };
		}
		if (current.value !== persistedRevision.value) {
			return { status: "stale", reasons: ["source_revision_changed"] };
		}
		return { status: "available", reasons: [] };
	}

	private async resolveSemanticReadiness(
		generation: PersistedStaticIntelligenceGeneration,
		bundle: StaticIntelligenceSourceBundle | null,
	): Promise<{ status: IntelligenceReadinessStatus; reasons: string[] }> {
		try {
			if (!bundle) {
				return { status: "failed", reasons: ["semantic_source_unavailable"] };
			}
			const rows = await this.embeddings.listExistingRows(generation.scanRunId);
			const sources = buildStaticIntelligenceEmbeddingSources(
				generation.export.payload,
				bundle,
			);
			return classifySemanticIndexReadiness(sources, rows);
		} catch {
			return { status: "failed", reasons: ["semantic_index_unavailable"] };
		}
	}
}

type SemanticIndexEntry = {
	sourceKind: string;
	sourceId: string;
	contentHash: string;
	embedding?: unknown;
};

export function classifySemanticIndexReadiness(
	sources: SemanticIndexEntry[],
	rows: SemanticIndexEntry[],
): { status: IntelligenceReadinessStatus; reasons: string[] } {
	const indexedRows = rows.filter((row) => row.embedding != null);
	if (indexedRows.length === 0) {
		return { status: "missing", reasons: ["semantic_index_missing"] };
	}
	const sourcesByKey = new Map(
		sources.map((source) => [semanticIndexKey(source), source]),
	);
	if (
		indexedRows.some((row) => {
			const source = sourcesByKey.get(semanticIndexKey(row));
			return !source || source.contentHash !== row.contentHash;
		})
	) {
		return { status: "stale", reasons: ["semantic_index_stale"] };
	}
	const indexedKeys = new Set(indexedRows.map(semanticIndexKey));
	if (sources.some((source) => !indexedKeys.has(semanticIndexKey(source)))) {
		return { status: "degraded", reasons: ["semantic_index_partial"] };
	}
	return { status: "available", reasons: [] };
}

function semanticIndexKey(entry: SemanticIndexEntry): string {
	return `${entry.sourceKind}\0${entry.sourceId}`;
}

function readinessForGeneration(
	generation: PersistedStaticIntelligenceGeneration,
	freshness: { status: IntelligenceReadinessStatus; reasons: string[] },
	semantic: { status: IntelligenceReadinessStatus; reasons: string[] },
): StaticIntelligenceReadiness {
	const payload = generation.export.payload;
	const structure = structureReadiness(generation);
	const evidenceReasons = payload.scanSummary.degradedReasons.filter(
		(reason) => reason === "external_path_redacted",
	);
	const reviewReasons = payload.scanSummary.degradedReasons.filter((reason) =>
		reason.includes("review"),
	);
	const exportReadiness = mergeReadiness(freshness, {
		status:
			payload.scanSummary.degradedReasons.length > 0 ? "degraded" : "available",
		reasons: payload.scanSummary.degradedReasons,
	});
	const fileRiskIndex = mergeReadiness(freshness, {
		status: evidenceReasons.length > 0 ? "degraded" : "available",
		reasons: evidenceReasons,
	});
	const codeStructure = mergeReadiness(freshness, structure);
	const agentBundle = mergeReadiness(freshness, {
		status:
			reviewReasons.length > 0 || codeStructure.status === "degraded"
				? "degraded"
				: "available",
		reasons: uniqueSorted([...reviewReasons, ...codeStructure.reasons]),
	});
	const ontology = mergeReadiness(freshness, {
		status:
			reviewReasons.length > 0 || codeStructure.status === "degraded"
				? "degraded"
				: "available",
		reasons: uniqueSorted([...reviewReasons, ...codeStructure.reasons]),
	});
	return {
		export: capability(
			generation,
			exportReadiness.status,
			exportReadiness.reasons,
		),
		fileRiskIndex: capability(
			generation,
			fileRiskIndex.status,
			fileRiskIndex.reasons,
		),
		evidenceGraph:
			payload.graph.nodes.length > 0
				? capability(generation, fileRiskIndex.status, fileRiskIndex.reasons)
				: capability(generation, "missing", ["evidence_graph_empty"]),
		codeStructure: capability(
			generation,
			codeStructure.status,
			codeStructure.reasons,
		),
		semanticIndex: capability(
			generation,
			freshness.status === "stale" ? "stale" : semantic.status,
			freshness.status === "stale" ? freshness.reasons : semantic.reasons,
		),
		agentBundle: capability(
			generation,
			agentBundle.status,
			agentBundle.reasons,
		),
		ontologyHandoff:
			generation.structure.snapshot.files.length > 0
				? capability(generation, ontology.status, ontology.reasons)
				: capability(generation, "degraded", ["module_candidates_missing"]),
	};
}

function structureReadiness(
	generation: PersistedStaticIntelligenceGeneration,
): {
	status: IntelligenceReadinessStatus;
	reasons: string[];
} {
	const snapshot = generation.projectStructure.snapshot;
	const reasons = snapshot.diagnostics
		.filter((diagnostic) => diagnostic.impact !== "none")
		.map((diagnostic) => diagnostic.code);
	return {
		status:
			snapshot.readiness.inventory.status === "failed" ||
			snapshot.readiness.analysis.status === "failed" ||
			snapshot.readiness.resolution.status === "failed"
				? "failed"
				: reasons.length > 0
					? "degraded"
					: "available",
		reasons: uniqueSorted(reasons),
	};
}

function mergeReadiness(
	freshness: { status: IntelligenceReadinessStatus; reasons: string[] },
	local: { status: IntelligenceReadinessStatus; reasons: string[] },
): { status: IntelligenceReadinessStatus; reasons: string[] } {
	if (freshness.status === "failed" || freshness.status === "stale") {
		return freshness;
	}
	if (freshness.status === "degraded") return freshness;
	return local;
}

function capability(
	generation: PersistedStaticIntelligenceGeneration,
	status: IntelligenceReadinessStatus,
	reasonCodes: string[],
): IntelligenceCapabilityReadiness {
	return {
		status,
		reasonCodes: uniqueSorted(reasonCodes),
		generatedAt: generation.structure.metadata.generatedAt,
		generationId: generation.generationId,
		sourceRef: `scan:${generation.scanRunId}`,
	};
}
