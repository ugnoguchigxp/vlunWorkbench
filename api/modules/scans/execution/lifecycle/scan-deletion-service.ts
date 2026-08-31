import { eq, inArray } from "drizzle-orm";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../../../db";
import {
	dastRuns,
	dynamicRuns,
	type ProjectArtifactCleanupManifest,
	projectDeletionCleanupJobs,
	reproductionRuns,
	scanRuns,
} from "../../../../db/schema";
import { HttpError } from "../../../auth/errors";
import type { ProjectArtifactCleanupRunner } from "./project-artifact-cleanup-runner";
import type { ProjectRepository, ScanRepository } from "../../repositories";
import {
	listScanActiveWork,
	type ScanActiveWork,
} from "./scan-deletion-active-work";

const scanHasActiveWorkError = (activeWork: ScanActiveWork[]) =>
	new HttpError(
		409,
		"Stop active work before deleting this scan run.",
		undefined,
		"SCAN_HAS_ACTIVE_WORK",
		{ activeWork },
	);

const isActiveWorkDeleteConstraint = (error: unknown): boolean =>
	error instanceof Error && error.message.includes("scan_has_active_work");

export class ScanDeletionService {
	constructor(
		private readonly deps: {
			db: AppDatabase;
			projectRepository: ProjectRepository;
			scanRepository: ScanRepository;
			cleanupRunner: Pick<ProjectArtifactCleanupRunner, "enqueue">;
		},
	) {}

	async deleteOwnedScan(params: { scanRunId: string; userId: string }) {
		const scan = await this.deps.scanRepository.findById(params.scanRunId);
		if (!scan) throw new HttpError(404, "Scan run not found");
		const project = await this.deps.projectRepository.findById(scan.projectId);
		if (!project || project.ownerUserId !== params.userId) {
			throw new HttpError(403, "Forbidden");
		}

		const activeWork = await listScanActiveWork(this.deps.db, params.scanRunId);
		if (activeWork.length > 0) {
			throw scanHasActiveWorkError(activeWork);
		}

		const manifest = await this.buildArtifactManifest(params.scanRunId);
		const now = new Date();
		const cleanupJob = {
			// A stable ID deduplicates cleanup work when DELETE requests overlap.
			id: `scan-run:${scan.id}`,
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
					// This durable ledger predates scan deletion and is shared intentionally:
					// the cleanup runner only consumes the manifest and job lifecycle fields.
					this.deps.db
						.insert(projectDeletionCleanupJobs)
						.values(cleanupJob)
						.onConflictDoNothing({ target: projectDeletionCleanupJobs.id }),
					this.deps.db.delete(scanRuns).where(eq(scanRuns.id, scan.id)),
					...(manifest.dynamicRunIds.length > 0
						? [
								this.deps.db
									.delete(dynamicRuns)
									.where(inArray(dynamicRuns.id, manifest.dynamicRunIds)),
							]
						: []),
				]);
			} else {
				runInProcessDbTransaction(this.deps.db, (transaction) => {
					transaction
						.insert(projectDeletionCleanupJobs)
						.values(cleanupJob)
						.onConflictDoNothing({ target: projectDeletionCleanupJobs.id })
						.run();
					const deleted = transaction
						.delete(scanRuns)
						.where(eq(scanRuns.id, scan.id))
						.returning({ id: scanRuns.id })
						.get();
					if (!deleted) {
						throw new HttpError(404, "Scan run not found");
					}
					if (manifest.dynamicRunIds.length > 0) {
						transaction
							.delete(dynamicRuns)
							.where(inArray(dynamicRuns.id, manifest.dynamicRunIds))
							.run();
					}
				});
			}
		} catch (error) {
			if (!isActiveWorkDeleteConstraint(error)) throw error;
			throw scanHasActiveWorkError(
				await listScanActiveWork(this.deps.db, params.scanRunId),
			);
		}
		this.deps.cleanupRunner.enqueue(cleanupJob.id);
		return {
			deletedScanRunId: scan.id,
			deletedAt: now,
			artifactCleanup: "queued" as const,
		};
	}

	private async buildArtifactManifest(
		scanRunId: string,
	): Promise<ProjectArtifactCleanupManifest> {
		const [dast, dynamic, reproduction] = await Promise.all([
			this.deps.db
				.select({ id: dastRuns.id })
				.from(dastRuns)
				.where(eq(dastRuns.scanRunId, scanRunId)),
			this.deps.db
				.select({ id: dynamicRuns.id })
				.from(dynamicRuns)
				.where(eq(dynamicRuns.scanRunId, scanRunId)),
			this.deps.db
				.select({ id: reproductionRuns.id })
				.from(reproductionRuns)
				.where(eq(reproductionRuns.scanRunId, scanRunId)),
		]);
		return {
			scanRunIds: [scanRunId],
			dastRunIds: dast.map((row) => row.id),
			dynamicRunIds: dynamic.map((row) => row.id),
			reproductionRunIds: reproduction.map((row) => row.id),
		};
	}
}
