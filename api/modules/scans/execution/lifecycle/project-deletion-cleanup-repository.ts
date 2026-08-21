import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { AppDatabase } from "../../../../db";
import {
	projectDeletionCleanupJobs,
	type ProjectArtifactCleanupManifest,
} from "../../../../db/schema";

export type ProjectDeletionCleanupStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed";

const STALE_RUNNING_JOB_MS = 5 * 60_000;

const recoverableStatusCondition = (now = new Date()) =>
	or(
		inArray(projectDeletionCleanupJobs.status, ["pending", "failed"]),
		and(
			eq(projectDeletionCleanupJobs.status, "running"),
			lt(
				projectDeletionCleanupJobs.updatedAt,
				new Date(now.getTime() - STALE_RUNNING_JOB_MS),
			),
		),
	);

export class ProjectDeletionCleanupRepository {
	constructor(private readonly db: AppDatabase) {}

	async create(params: {
		ownerUserId: string;
		projectId: string;
		projectName: string;
		manifest: ProjectArtifactCleanupManifest;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(projectDeletionCleanupJobs)
			.values({ ...params, status: "pending", createdAt: now, updatedAt: now })
			.returning();
		if (!created) throw new Error("Project cleanup job was not persisted.");
		return created;
	}

	async findById(jobId: string) {
		return (
			(await this.db.query.projectDeletionCleanupJobs.findFirst({
				where: eq(projectDeletionCleanupJobs.id, jobId),
			})) ?? null
		);
	}

	async listRecoverable(now = new Date()) {
		return await this.db.query.projectDeletionCleanupJobs.findMany({
			where: recoverableStatusCondition(now),
			orderBy: [asc(projectDeletionCleanupJobs.createdAt)],
		});
	}

	async claim(jobId: string, now = new Date()) {
		const [claimed] = await this.db
			.update(projectDeletionCleanupJobs)
			.set({
				status: "running",
				attemptCount: sql`${projectDeletionCleanupJobs.attemptCount} + 1`,
				lastError: null,
				updatedAt: now,
			})
			.where(
				and(
					eq(projectDeletionCleanupJobs.id, jobId),
					recoverableStatusCondition(now),
				),
			)
			.returning();
		return claimed ?? null;
	}

	async complete(jobId: string) {
		const now = new Date();
		await this.db
			.update(projectDeletionCleanupJobs)
			.set({ status: "completed", completedAt: now, updatedAt: now })
			.where(eq(projectDeletionCleanupJobs.id, jobId));
	}

	async fail(jobId: string, error: unknown) {
		const message =
			error instanceof Error ? error.message : "Artifact cleanup failed";
		await this.db
			.update(projectDeletionCleanupJobs)
			.set({
				status: "failed",
				lastError: message.slice(0, 1_000),
				updatedAt: new Date(),
			})
			.where(eq(projectDeletionCleanupJobs.id, jobId));
	}
}
