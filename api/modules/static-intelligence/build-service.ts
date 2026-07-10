import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { AppDatabase } from "../../db";
import type { ArtifactStorage } from "../scans/artifact-storage";
import { buildCodeStructureSnapshot } from "./code-structure/extractor";
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

export type StaticIntelligenceBuildStage = {
	name: "code_structure" | "export" | "persist" | "semantic_index";
	status: "completed" | "degraded" | "skipped";
	reasonCodes: string[];
	durationMs: number;
};

export type StaticIntelligenceBuildResult = {
	ok: true;
	status: "completed" | "partial";
	scanRunId: string;
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

	const stages: StaticIntelligenceBuildStage[] = [];
	const codeStructureStartedAt = Date.now();
	const snapshot = await buildCodeStructureSnapshot({
		projectPath: bundle.project.repoPath,
		projectId: bundle.project.id,
		maxFiles: params.maxFiles ?? 5000,
	});
	stages.push({
		name: "code_structure",
		status: snapshot.status === "partial" ? "degraded" : "completed",
		reasonCodes: snapshot.degradedReasons,
		durationMs: Date.now() - codeStructureStartedAt,
	});

	const exportStartedAt = Date.now();
	const exportPayload = buildStaticIntelligenceExportFromBundle(bundle, {
		generatedAt: params.generatedAt,
		codeStructureSnapshot: snapshot,
	});
	stages.push({
		name: "export",
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
		exportPayload,
		sourceRevision: resolveSourceRevision(
			bundle.project.repoPath,
			buildSourceTreeHash(snapshot),
		),
		expectedSourceStateHash: buildSourceStateHash(bundle),
	});
	stages.push({
		name: "persist",
		status: generation.status === "degraded" ? "degraded" : "completed",
		reasonCodes: generation.structure.metadata.degradedReasons,
		durationMs: Date.now() - persistStartedAt,
	});

	const semanticStartedAt = Date.now();
	if (!params.includeSemantic) {
		stages.push({
			name: "semantic_index",
			status: "skipped",
			reasonCodes: ["semantic_index_not_requested"],
			durationMs: 0,
		});
	} else if (!params.semanticIndexer) {
		stages.push({
			name: "semantic_index",
			status: "skipped",
			reasonCodes: ["semantic_index_provider_unavailable"],
			durationMs: 0,
		});
	} else {
		try {
			await params.semanticIndexer(params.scanRunId);
			stages.push({
				name: "semantic_index",
				status: "completed",
				reasonCodes: [],
				durationMs: Date.now() - semanticStartedAt,
			});
		} catch {
			stages.push({
				name: "semantic_index",
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
	return {
		ok: true,
		status:
			generation.status === "degraded" ||
			stages.some((stage) => stage.status === "degraded")
				? "partial"
				: "completed",
		scanRunId,
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
		stages,
	};
}

function isReadableDirectory(projectPath: string): boolean {
	try {
		return fs.statSync(projectPath).isDirectory();
	} catch {
		return false;
	}
}

function resolveSourceRevision(
	projectPath: string,
	sourceTreeHash: string,
): StaticIntelligenceSourceRevision {
	try {
		const head = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!head) throw new Error("Git HEAD is empty.");
		const dirty = execFileSync("git", ["status", "--porcelain=v1"], {
			cwd: projectPath,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const dirtyHash = dirty
			? sha256Text(`${dirty}\n${sourceTreeHash}`)
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
