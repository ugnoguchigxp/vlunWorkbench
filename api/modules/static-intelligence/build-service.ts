import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { AppDatabase } from "../../db";
import type { ArtifactStorage } from "../scans/artifact-storage";
import { buildProjectStructureSnapshot } from "./project-structure/builder";
import { projectStructureV2ToCodeStructureV1 } from "./project-structure/v1-projector";
import { emitProjectStructureComparisonTelemetry } from "./project-structure/rollout";
import { buildStaticIntelligenceExportFromBundle } from "./export-builder";
import {
	type PersistedStaticIntelligenceGeneration,
	StaticIntelligenceGenerationRepository,
} from "./generation-repository";
import {
	buildSourceStateHash,
	buildSourceTreeHash,
	type StaticIntelligenceSourceRevision,
	sha256Text,
} from "./generation-types";
import { StaticIntelligenceRepository } from "./repository";
import { buildStaticIntelligenceKnowledgeSourceManifest } from "./knowledge-source-manifest";
import type { StaticIntelligenceReadiness } from "../../../shared/schemas/static-intelligence-module.schema";

const GIT_PROBE_TIMEOUT_MS = 30_000;

export type StaticIntelligenceBuildStage = {
	name:
		| "validate_source"
		| "build_inventory"
		| "analyze_files"
		| "resolve_references"
		| "infer_modules"
		| "build_v2_snapshot"
		| "project_export_projection"
		| "normalize_paths"
		| "build_export"
		| "persist_generation"
		| "build_manifest"
		| "optional_semantic_index";
	status: "completed" | "degraded" | "skipped";
	reasonCodes: string[];
	durationMs: number;
};

export type StaticIntelligenceBuildResult = {
	ok: true;
	status: "completed" | "partial";
	projectId: string;
	scanRunId: string;
	generationId: string;
	generatedAt: string;
	generation: {
		generationId: string;
		status: "available" | "degraded";
		generatedAt: string;
		sourceTreeHash: string;
		sourceStateHash: string;
		snapshotRef: string;
		exportHash: string;
		degradedReasons: string[];
	};
	artifacts: {
		projectStructure?: { id: string; sha256: string; snapshotRef: string };
		structure: { id: string; sha256: string; snapshotRef: string };
		export: { id: string; sha256: string; exportHash: string };
	};
	readiness: StaticIntelligenceReadiness;
	degradedReasons: string[];
	stages: StaticIntelligenceBuildStage[];
};

export class StaticIntelligenceBuildInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StaticIntelligenceBuildInputError";
	}
}

export async function buildStaticIntelligenceGeneration(params: {
	db: AppDatabase;
	scanRunId: string;
	artifactStorage?: ArtifactStorage;
	generatedAt?: Date;
	maxFiles?: number;
	includeSemantic?: boolean;
	semanticIndexer?: (scanRunId: string) => Promise<void>;
	emitTelemetry?: boolean;
}): Promise<StaticIntelligenceBuildResult> {
	const sourceRepository = new StaticIntelligenceRepository(params.db);
	const bundle = await sourceRepository.loadSourceBundle(params.scanRunId);
	if (!bundle) {
		throw new StaticIntelligenceBuildInputError(
			`Scan run not found: ${params.scanRunId}`,
		);
	}
	if (!isReadableDirectory(bundle.project.repoPath)) {
		throw new StaticIntelligenceBuildInputError(
			"Registered project path is unavailable.",
		);
	}

	const stages: StaticIntelligenceBuildStage[] = [
		{
			name: "validate_source",
			status: "completed",
			reasonCodes: [],
			durationMs: 0,
		},
	];
	const codeStructureStartedAt = Date.now();
	const projectStructureSnapshot = await buildProjectStructureSnapshot({
		projectPath: bundle.project.repoPath,
		projectId: bundle.project.id,
		maxFiles: params.maxFiles ?? 5000,
	});
	const snapshot = projectStructureV2ToCodeStructureV1(
		projectStructureSnapshot,
	);
	if (params.emitTelemetry)
		emitProjectStructureComparisonTelemetry({
			durationMs: Date.now() - codeStructureStartedAt,
			v1FileCount: snapshot.summary.fileCount,
			v2FileCount: projectStructureSnapshot.summary.fileCount,
			v2ResolvedCount: projectStructureSnapshot.summary.resolvedReferenceCount,
			v2UnresolvedCount:
				projectStructureSnapshot.summary.unresolvedReferenceCount,
			diagnosticCodes: projectStructureSnapshot.diagnostics.map(
				(diagnostic) => diagnostic.code,
			),
		});
	for (const [name, readiness] of [
		["build_inventory", projectStructureSnapshot.readiness.inventory],
		["analyze_files", projectStructureSnapshot.readiness.analysis],
		["resolve_references", projectStructureSnapshot.readiness.resolution],
		["infer_modules", projectStructureSnapshot.readiness.moduleInference],
	] as const) {
		stages.push({
			name,
			status: readiness.status === "available" ? "completed" : "degraded",
			reasonCodes: readiness.reasonCodes,
			durationMs: 0,
		});
	}
	stages.push({
		name: "build_v2_snapshot",
		status:
			projectStructureSnapshot.status === "partial" ? "degraded" : "completed",
		reasonCodes: projectStructureSnapshot.diagnostics.map(
			(diagnostic) => diagnostic.code,
		),
		durationMs: Date.now() - codeStructureStartedAt,
	});
	stages.push({
		name: "project_export_projection",
		status: snapshot.status === "partial" ? "degraded" : "completed",
		reasonCodes: snapshot.degradedReasons,
		durationMs: 0,
	});

	const exportStartedAt = Date.now();
	const exportPayload = buildStaticIntelligenceExportFromBundle(bundle, {
		generatedAt: params.generatedAt,
		codeStructureSnapshot: snapshot,
	});
	const pathReasonCodes = exportPayload.scanSummary.degradedReasons.filter(
		(reason) => reason === "external_path_redacted",
	);
	stages.push({
		name: "normalize_paths",
		status: pathReasonCodes.length > 0 ? "degraded" : "completed",
		reasonCodes: pathReasonCodes,
		durationMs: 0,
	});
	stages.push({
		name: "build_export",
		status:
			exportPayload.scanSummary.degradedReasons.length > 0
				? "degraded"
				: "completed",
		reasonCodes: exportPayload.scanSummary.degradedReasons,
		durationMs: Date.now() - exportStartedAt,
	});

	const persistStartedAt = Date.now();
	const generation = await new StaticIntelligenceGenerationRepository(
		params.db,
		params.artifactStorage,
	).persistGeneration({
		scanRunId: params.scanRunId,
		snapshot,
		projectStructureSnapshot,
		exportPayload,
		sourceRevision: probeSourceRevision(
			bundle.project.repoPath,
			buildSourceTreeHash(snapshot),
		),
		expectedSourceStateHash: buildSourceStateHash(bundle),
	});
	stages.push({
		name: "persist_generation",
		status: generation.status === "degraded" ? "degraded" : "completed",
		reasonCodes: generation.structure.metadata.degradedReasons,
		durationMs: Date.now() - persistStartedAt,
	});

	const manifestStartedAt = Date.now();
	buildStaticIntelligenceKnowledgeSourceManifest(generation.export.payload, {
		generation,
	});
	stages.push({
		name: "build_manifest",
		status: generation.status === "degraded" ? "degraded" : "completed",
		reasonCodes: generation.structure.metadata.degradedReasons,
		durationMs: Date.now() - manifestStartedAt,
	});

	const semanticStartedAt = Date.now();
	if (!params.includeSemantic) {
		stages.push({
			name: "optional_semantic_index",
			status: "skipped",
			reasonCodes: ["semantic_index_not_requested"],
			durationMs: 0,
		});
	} else if (!params.semanticIndexer) {
		stages.push({
			name: "optional_semantic_index",
			status: "skipped",
			reasonCodes: ["semantic_index_provider_unavailable"],
			durationMs: 0,
		});
	} else {
		try {
			await params.semanticIndexer(params.scanRunId);
			stages.push({
				name: "optional_semantic_index",
				status: "completed",
				reasonCodes: [],
				durationMs: Date.now() - semanticStartedAt,
			});
		} catch {
			stages.push({
				name: "optional_semantic_index",
				status: "degraded",
				reasonCodes: ["semantic_index_failed"],
				durationMs: Date.now() - semanticStartedAt,
			});
		}
	}

	return buildResult(params.scanRunId, generation, stages);
}

function buildResult(
	scanRunId: string,
	generation: PersistedStaticIntelligenceGeneration,
	stages: StaticIntelligenceBuildStage[],
): StaticIntelligenceBuildResult {
	const structureMetadata = generation.structure.metadata;
	const exportMetadata = generation.export.metadata;
	const snapshotRef = structureMetadata.snapshotRef;
	const exportHash = exportMetadata.exportHash;
	if (!snapshotRef || !exportHash) {
		throw new Error("Persisted generation metadata is incomplete.");
	}
	const semanticStage = stages.find(
		(stage) => stage.name === "optional_semantic_index",
	);
	const readiness = buildReadiness(generation, semanticStage);
	const degradedReasons = uniqueReasons([
		...generation.structure.metadata.degradedReasons,
		...stages.flatMap((stage) =>
			stage.status === "degraded" ? stage.reasonCodes : [],
		),
	]);
	return {
		ok: true,
		status:
			generation.status === "degraded" ||
			stages.some((stage) => stage.status === "degraded")
				? "partial"
				: "completed",
		projectId: generation.projectId,
		scanRunId,
		generationId: generation.generationId,
		generatedAt: structureMetadata.generatedAt,
		generation: {
			generationId: generation.generationId,
			status: generation.status,
			generatedAt: structureMetadata.generatedAt,
			sourceTreeHash: structureMetadata.sourceTreeHash,
			sourceStateHash: structureMetadata.sourceStateHash,
			snapshotRef,
			exportHash,
			degradedReasons: structureMetadata.degradedReasons,
		},
		artifacts: {
			...(generation.projectStructure
				? {
						projectStructure: {
							id: generation.projectStructure.artifact.id,
							sha256: generation.projectStructure.artifact.sha256,
							snapshotRef:
								generation.projectStructure.metadata.snapshotRef ?? "",
						},
					}
				: {}),
			structure: {
				id: generation.structure.artifact.id,
				sha256: generation.structure.artifact.sha256,
				snapshotRef,
			},
			export: {
				id: generation.export.artifact.id,
				sha256: generation.export.artifact.sha256,
				exportHash,
			},
		},
		readiness,
		degradedReasons,
		stages,
	};
}

function buildReadiness(
	generation: PersistedStaticIntelligenceGeneration,
	semanticStage: StaticIntelligenceBuildStage | undefined,
): StaticIntelligenceReadiness {
	const codeStructureReasons = generation.projectStructure
		? generation.projectStructure.snapshot.diagnostics
				.filter((diagnostic) => diagnostic.impact !== "none")
				.map((diagnostic) => diagnostic.code)
		: generation.structure.snapshot.degradedReasons;
	const codeStructureStatus = generation.projectStructure
		? codeStructureReasons.length > 0
			? ("degraded" as const)
			: ("available" as const)
		: generation.structure.snapshot.status === "partial"
			? ("degraded" as const)
			: ("available" as const);
	const exportReasons = generation.export.payload.scanSummary.degradedReasons;
	const reviewReasons = exportReasons.filter((reason) =>
		reason.includes("review"),
	);
	const base = {
		status: "available" as const,
		reasonCodes: [],
		generatedAt: generation.structure.metadata.generatedAt,
		generationId: generation.generationId,
		sourceRef: `scan:${generation.scanRunId}`,
	};
	const semantic =
		semanticStage?.status === "completed"
			? base
			: {
					...base,
					status:
						semanticStage?.status === "degraded"
							? ("degraded" as const)
							: ("missing" as const),
					reasonCodes: semanticStage?.reasonCodes ?? ["semantic_index_missing"],
				};
	return {
		export: {
			...base,
			status: exportReasons.length > 0 ? "degraded" : "available",
			reasonCodes: exportReasons,
		},
		fileRiskIndex: base,
		evidenceGraph: base,
		codeStructure: {
			...base,
			status: codeStructureStatus,
			reasonCodes: codeStructureReasons,
		},
		semanticIndex: semantic,
		agentBundle: {
			...base,
			status:
				reviewReasons.length > 0 || codeStructureStatus !== "available"
					? "degraded"
					: "available",
			reasonCodes: [...reviewReasons, ...codeStructureReasons],
		},
		ontologyHandoff:
			generation.structure.snapshot.files.length > 0
				? {
						...base,
						status:
							reviewReasons.length > 0 || codeStructureStatus !== "available"
								? "degraded"
								: "available",
						reasonCodes: [...reviewReasons, ...codeStructureReasons],
					}
				: {
						...base,
						status: "degraded",
						reasonCodes: ["module_candidates_missing"],
					},
	};
}

function uniqueReasons(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))].sort((a, b) =>
		a.localeCompare(b),
	);
}

function isReadableDirectory(projectPath: string): boolean {
	try {
		return fs.statSync(projectPath).isDirectory();
	} catch {
		return false;
	}
}

export function probeSourceRevision(
	projectPath: string,
	sourceTreeHash: string,
): StaticIntelligenceSourceRevision {
	try {
		const head = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 1024 * 1024,
			timeout: GIT_PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		}).trim();
		if (!head) throw new Error("Git HEAD is empty.");
		const dirty = execFileSync("git", ["status", "--porcelain=v1"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 4 * 1024 * 1024,
			timeout: GIT_PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		}).trim();
		const dirtyHash = dirty
			? buildDirtyStateHash(projectPath, dirty, sourceTreeHash)
			: undefined;
		return {
			kind: "git",
			head,
			...(dirtyHash ? { dirtyHash } : {}),
			value: sha256Text(`${head}\n${dirtyHash ?? "clean"}`),
		};
	} catch {
		return {
			kind: "tree_hash_only",
			value: sourceTreeHash,
		};
	}
}

function buildDirtyStateHash(
	projectPath: string,
	status: string,
	sourceTreeHash: string,
): string {
	const diff = execFileSync(
		"git",
		["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
		{
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 4 * 1024 * 1024,
			timeout: GIT_PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		},
	);
	const untrackedOutput = execFileSync(
		"git",
		["ls-files", "--others", "--exclude-standard", "-z"],
		{
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 1024 * 1024,
			timeout: GIT_PROBE_TIMEOUT_MS,
			killSignal: "SIGKILL",
		},
	);
	const untracked = untrackedOutput
		.split("\0")
		.filter(Boolean)
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 200)
		.map((relativePath) => {
			const absolutePath = `${projectPath}/${relativePath}`;
			try {
				const stat = fs.lstatSync(absolutePath);
				if (stat.isSymbolicLink()) return `${relativePath}:symlink`;
				if (!stat.isFile()) return `${relativePath}:non_file`;
				if (stat.size > 1024 * 1024) {
					return `${relativePath}:${stat.size}:${stat.mtimeMs}`;
				}
				return `${relativePath}:${sha256Text(
					fs.readFileSync(absolutePath).toString("base64"),
				)}`;
			} catch {
				return `${relativePath}:unavailable`;
			}
		});
	return sha256Text(
		JSON.stringify({ status, diff, untracked, sourceTreeHash }),
	);
}
