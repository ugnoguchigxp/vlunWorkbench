import { desc, eq } from "drizzle-orm";
import type {
	ProjectExplorationCatalogReadiness,
	ProjectExplorationCatalogSource,
} from "../../../shared/schemas/static-intelligence-exploration-catalog.schema";
import type { AppDatabase } from "../../db";
import { scanRuns } from "../../db/schema";
import { ScanRepository } from "../scans/repositories";
import { summarizeProjectExplorationReadiness } from "./exploration-catalog";
import { StaticIntelligenceGenerationRepository } from "./generation-repository";
import type { PersistedStaticIntelligenceGeneration } from "./generation-repository-types";
import { StaticIntelligencePrepareRepository } from "./prepare-repository";
import {
	ProjectPathResolutionError,
	resolveStaticIntelligenceProjectByPath,
} from "./project-path-resolver";
import { computeProjectSourceFingerprint } from "./project-source-fingerprint";

export type ProjectIntelligenceStage =
	| "structure_scan"
	| "security_scan"
	| "generation_build"
	| "publishing"
	| "complete";

export type ProjectIntelligenceStatusResult = {
	ok: boolean;
	status: "not_prepared" | "queued" | "running" | "ready" | "stale" | "failed";
	projectPath: string;
	stage?: ProjectIntelligenceStage;
	reused?: boolean;
	retryAfterMs?: number;
	nextAction?: "vuln_prepare_project_intelligence";
	errorCode?: string;
	message?: string;
	retryable?: boolean;
	durationMs?: number;
	source?: ProjectExplorationCatalogSource;
	readiness?: ProjectExplorationCatalogReadiness;
	provenance?: {
		projectId: string;
		scanRunId?: string;
		generationId?: string;
		prepareJobId?: string;
	};
};

export async function prepareProjectIntelligence(params: {
	db: AppDatabase;
	projectPath: string;
	allowedProjectRoots: string[];
	createProject?: boolean;
}): Promise<ProjectIntelligenceStatusResult> {
	try {
		const resolved = await resolveStaticIntelligenceProjectByPath({
			db: params.db,
			projectPath: params.projectPath,
			allowedProjectRoots: params.allowedProjectRoots,
			createProject: params.createProject ?? true,
		});
		if (!resolved.project) {
			return {
				ok: false,
				status: "not_prepared",
				projectPath: resolved.projectPath,
				errorCode: "PROJECT_NOT_REGISTERED",
				message: "The project is not registered in vulnWorkbench.",
				retryable: false,
			};
		}
		const source = await computeProjectSourceFingerprint(resolved.projectPath);
		const jobs = new StaticIntelligencePrepareRepository(params.db);
		const generations = new StaticIntelligenceGenerationRepository(params.db);
		const ready = await jobs.findReady(resolved.project.id, source.value);
		if (ready?.scanRunId && ready.generationId) {
			const generation = await generations.loadGeneration(
				ready.scanRunId,
				ready.generationId,
			);
			if (generation) {
				return statusResponse(
					ready,
					resolved.projectPath,
					"ready",
					true,
					generation,
				);
			}
		}

		const active = await jobs.findActive(resolved.project.id, source.value);
		if (active) {
			return statusResponse(
				active,
				resolved.projectPath,
				active.status === "running" ? "running" : "queued",
				false,
			);
		}

		let job: Awaited<ReturnType<typeof jobs.create>>;
		try {
			job = await jobs.create({
				projectId: resolved.project.id,
				canonicalProjectPath: resolved.projectPath,
				sourceFingerprint: source.value,
			});
		} catch (error) {
			const concurrent = await jobs.findActive(
				resolved.project.id,
				source.value,
			);
			if (!concurrent) throw error;
			return statusResponse(
				concurrent,
				resolved.projectPath,
				concurrent.status === "running" ? "running" : "queued",
				false,
			);
		}

		try {
			const scanRun = await new ScanRepository(params.db).createScanRun({
				projectId: resolved.project.id,
				profile: "static-intelligence-structure-v1",
				status: "queued",
				metadata: {
					source: "static-intelligence-prepare",
					prepareJobId: job.id,
					sourceFingerprint: source.value,
				},
			});
			job = (await jobs.attachQueuedScan(job.id, scanRun.id)) ?? job;
			return statusResponse(job, resolved.projectPath, "queued", false);
		} catch {
			await jobs.update(job.id, {
				status: "failed",
				stage: "structure_scan",
				errorCode: "INTERNAL_ERROR",
				errorMessageRedacted: "The prepare job could not be queued.",
				retryable: true,
				completedAt: new Date(),
			});
			return {
				ok: false,
				status: "failed",
				projectPath: resolved.projectPath,
				errorCode: "INTERNAL_ERROR",
				message: "The prepare job could not be queued.",
				retryable: true,
			};
		}
	} catch (error) {
		return pathErrorResponse(error, params.projectPath);
	}
}

export async function getProjectIntelligenceStatus(params: {
	db: AppDatabase;
	projectPath: string;
	allowedProjectRoots: string[];
}): Promise<ProjectIntelligenceStatusResult> {
	try {
		const resolved = await resolveStaticIntelligenceProjectByPath({
			db: params.db,
			projectPath: params.projectPath,
			allowedProjectRoots: params.allowedProjectRoots,
			createProject: false,
		});
		if (!resolved.project) {
			return {
				ok: false,
				status: "not_prepared",
				projectPath: resolved.projectPath,
				nextAction: "vuln_prepare_project_intelligence",
				errorCode: "PROJECT_NOT_PREPARED",
				message: "Static Intelligence has not been prepared for this project.",
				retryable: true,
			};
		}
		const source = await computeProjectSourceFingerprint(resolved.projectPath);
		const jobs = new StaticIntelligencePrepareRepository(params.db);
		const active = await jobs.findActive(resolved.project.id, source.value);
		if (active) {
			return statusResponse(
				active,
				resolved.projectPath,
				active.status === "running" ? "running" : "queued",
				false,
			);
		}
		const ready = await jobs.findReady(resolved.project.id, source.value);
		if (ready?.scanRunId && ready.generationId) {
			const generation = await new StaticIntelligenceGenerationRepository(
				params.db,
			).loadGeneration(ready.scanRunId, ready.generationId);
			if (generation) {
				return statusResponse(
					ready,
					resolved.projectPath,
					"ready",
					true,
					generation,
				);
			}
		}
		const latestGeneration = await loadLatestPublishedGeneration(
			params.db,
			resolved.project.id,
		);
		if (latestGeneration) {
			return {
				ok: true,
				status: "stale",
				projectPath: resolved.projectPath,
				stage: "complete",
				reused: true,
				nextAction: "vuln_prepare_project_intelligence",
				...generationCapability(latestGeneration),
				provenance: {
					projectId: resolved.project.id,
					scanRunId: latestGeneration.scanRunId,
					generationId: latestGeneration.generationId,
				},
			};
		}
		const latest = await jobs.findLatest(resolved.project.id);
		if (latest?.status === "failed") {
			return {
				ok: false,
				status: "failed",
				projectPath: resolved.projectPath,
				stage: externalStage(latest.stage),
				errorCode: latest.errorCode ?? "INTERNAL_ERROR",
				message:
					latest.errorMessageRedacted ??
					"Static Intelligence preparation failed.",
				retryable: latest.retryable ?? true,
				provenance: {
					projectId: resolved.project.id,
					prepareJobId: latest.id,
					...(latest.scanRunId ? { scanRunId: latest.scanRunId } : {}),
				},
			};
		}
		return {
			ok: false,
			status: "not_prepared",
			projectPath: resolved.projectPath,
			nextAction: "vuln_prepare_project_intelligence",
			errorCode: "PROJECT_NOT_PREPARED",
			message: "Static Intelligence has not been prepared for this project.",
			retryable: true,
		};
	} catch (error) {
		return pathErrorResponse(error, params.projectPath);
	}
}

export async function loadLatestPublishedGeneration(
	db: AppDatabase,
	projectId: string,
) {
	const rows = await db
		.select({ id: scanRuns.id })
		.from(scanRuns)
		.where(eq(scanRuns.projectId, projectId))
		.orderBy(desc(scanRuns.updatedAt), desc(scanRuns.id));
	const repository = new StaticIntelligenceGenerationRepository(db);
	for (const row of rows) {
		const generation = await repository.loadLatestValidGeneration(row.id);
		if (generation) return generation;
	}
	return null;
}

function statusResponse(
	job: NonNullable<
		Awaited<ReturnType<StaticIntelligencePrepareRepository["findById"]>>
	>,
	projectPath: string,
	status: "queued" | "running" | "ready",
	reused: boolean,
	generation?: PersistedStaticIntelligenceGeneration,
): ProjectIntelligenceStatusResult {
	return {
		ok: true,
		status,
		projectPath,
		stage: externalStage(job.stage),
		reused,
		durationMs: Math.max(
			0,
			(job.completedAt ?? new Date()).getTime() - job.createdAt.getTime(),
		),
		...(status === "ready" ? {} : { retryAfterMs: 2000 }),
		...(status === "ready" && generation
			? generationCapability(generation)
			: {}),
		provenance: {
			projectId: job.projectId,
			prepareJobId: job.id,
			...(job.scanRunId ? { scanRunId: job.scanRunId } : {}),
			...(job.generationId ? { generationId: job.generationId } : {}),
		},
	};
}

function generationCapability(
	generation: PersistedStaticIntelligenceGeneration,
): Pick<ProjectIntelligenceStatusResult, "source" | "readiness"> {
	const metadata = generation.projectStructure.metadata;
	if (!metadata.snapshotRef) return {};
	return {
		source: {
			structureSchemaVersion: "project-structure-v2",
			snapshotRef: metadata.snapshotRef,
			revision: metadata.sourceRevision,
		},
		readiness: summarizeProjectExplorationReadiness(
			generation.projectStructure.snapshot,
			generation.status,
		),
	};
}

function externalStage(stage: string): ProjectIntelligenceStage {
	if (stage === "structure_scan") return "structure_scan";
	if (stage === "generation_build") return "generation_build";
	if (stage === "publishing") return "publishing";
	if (stage === "complete") return "complete";
	return "security_scan";
}

function pathErrorResponse(
	error: unknown,
	projectPath: string,
): ProjectIntelligenceStatusResult {
	if (error instanceof ProjectPathResolutionError) {
		return {
			ok: false,
			status: "failed",
			projectPath,
			errorCode: error.code,
			message: error.message,
			retryable: error.retryable,
		};
	}
	return {
		ok: false,
		status: "failed",
		projectPath,
		errorCode: "INTERNAL_ERROR",
		message: "Static Intelligence is temporarily unavailable.",
		retryable: true,
	};
}
