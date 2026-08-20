import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../db";
import {
	dastRuns,
	dynamicRuns,
	type ProjectArtifactCleanupManifest,
	projectDeletionCleanupJobs,
	projects,
	reproductionRuns,
	scanRuns,
} from "../../db/schema";
import { HttpError } from "../auth/errors";
import type { ProjectArtifactCleanupRunner } from "./project-artifact-cleanup-runner";
import {
	listProjectActiveWork,
	type ProjectActiveWork,
} from "./project-deletion-active-work";
import type { ProjectRepository } from "./repositories";

const projectHasActiveWorkError = (activeWork: ProjectActiveWork[]) =>
	new HttpError(
		409,
		"Stop active work before deleting this project.",
		undefined,
		"PROJECT_HAS_ACTIVE_WORK",
		{ activeWork },
	);

const isActiveWorkDeleteConstraint = (error: unknown): boolean =>
	error instanceof Error &&
	(error.message.includes("scan_has_active_work") ||
		error.message.includes("project_has_active_work"));

export class ProjectDeletionService {
	constructor(
		private readonly deps: {
			db: AppDatabase;
			projectRepository: ProjectRepository;
			cleanupRunner: ProjectArtifactCleanupRunner;
		},
	) {}

	async deleteOwnedProject(params: {
		projectId: string;
		userId: string;
		confirmation: string;
	}) {
		const project = await this.deps.projectRepository.findById(
			params.projectId,
		);
		if (!project) throw new HttpError(404, "Project not found");
		if (project.ownerUserId !== params.userId)
			throw new HttpError(403, "Forbidden");
		if (project.name !== params.confirmation) {
			throw new HttpError(
				400,
				"Project name confirmation does not match.",
				undefined,
				"PROJECT_CONFIRMATION_MISMATCH",
			);
		}

		const activeWork = await listProjectActiveWork(
			this.deps.db,
			params.projectId,
		);
		if (activeWork.length > 0) {
			throw projectHasActiveWorkError(activeWork);
		}

		const manifest = await this.buildArtifactManifest(params.projectId);
		const now = new Date();
		const cleanupJob = {
			id: randomUUID(),
			ownerUserId: params.userId,
			projectId: project.id,
			projectName: project.name,
			manifest,
			status: "pending" as const,
			attemptCount: 0,
			createdAt: now,
			updatedAt: now,
		};
		const writer = writerClientForDatabase(this.deps.db);
		try {
			if (writer) {
				await writer.atomicDrizzleBatch([
					this.deps.db.insert(projectDeletionCleanupJobs).values(cleanupJob),
					this.deps.db
						.delete(projects)
						.where(
							and(
								eq(projects.id, project.id),
								eq(projects.ownerUserId, params.userId),
							),
						),
				]);
			} else {
				runInProcessDbTransaction(this.deps.db, (transaction) => {
					transaction
						.insert(projectDeletionCleanupJobs)
						.values(cleanupJob)
						.run();
					const deleted = transaction
						.delete(projects)
						.where(
							and(
								eq(projects.id, project.id),
								eq(projects.ownerUserId, params.userId),
							),
						)
						.returning({ id: projects.id })
						.get();
					if (!deleted) throw new HttpError(404, "Project not found");
				});
			}
		} catch (error) {
			if (!isActiveWorkDeleteConstraint(error)) throw error;
			throw projectHasActiveWorkError(
				await listProjectActiveWork(this.deps.db, params.projectId),
			);
		}
		this.deps.cleanupRunner.enqueue(cleanupJob.id);
		return {
			deletedProjectId: project.id,
			deletedAt: now,
			artifactCleanup: "queued" as const,
		};
	}

	private async buildArtifactManifest(
		projectId: string,
	): Promise<ProjectArtifactCleanupManifest> {
		const [scan, dast, dynamic, reproduction] = await Promise.all([
			this.deps.db
				.select({ id: scanRuns.id })
				.from(scanRuns)
				.where(eq(scanRuns.projectId, projectId)),
			this.deps.db
				.select({ id: dastRuns.id })
				.from(dastRuns)
				.where(eq(dastRuns.projectId, projectId)),
			this.deps.db
				.select({ id: dynamicRuns.id })
				.from(dynamicRuns)
				.where(eq(dynamicRuns.projectId, projectId)),
			this.deps.db
				.select({ id: reproductionRuns.id })
				.from(reproductionRuns)
				.where(eq(reproductionRuns.projectId, projectId)),
		]);
		return {
			scanRunIds: scan.map((row) => row.id),
			dastRunIds: dast.map((row) => row.id),
			dynamicRunIds: dynamic.map((row) => row.id),
			reproductionRunIds: reproduction.map((row) => row.id),
		};
	}
}
