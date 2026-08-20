import type { DastArtifactStorage } from "../dast/dast-artifact-storage";
import type { DynamicArtifactStorage } from "../dynamic/dynamic-artifact-storage";
import type { ReproductionArtifactStorage } from "../reproductions/reproduction-artifact-storage";
import type { ArtifactStorage } from "./artifact-storage";
import type { ProjectDeletionCleanupRepository } from "./project-deletion-cleanup-repository";

type ArtifactStorageDeps = {
	scanStorage: Pick<ArtifactStorage, "removeRunDirectory">;
	dastStorage: Pick<DastArtifactStorage, "removeRunDirectory">;
	dynamicStorage: Pick<DynamicArtifactStorage, "removeRunDirectory">;
	reproductionStorage: Pick<ReproductionArtifactStorage, "removeRunDirectory">;
};

/** Cleans server-owned artifact roots after the DB cascade commits. */
export class ProjectArtifactCleanupRunner {
	private readonly inFlight = new Map<string, Promise<void>>();

	constructor(
		private readonly repository: ProjectDeletionCleanupRepository,
		private readonly storage: ArtifactStorageDeps,
	) {}

	enqueue(jobId: string): void {
		if (this.inFlight.has(jobId)) return;
		const task = this.run(jobId)
			.catch((error) => {
				console.error(
					`Project artifact cleanup job ${jobId} could not start:`,
					error,
				);
			})
			.finally(() => this.inFlight.delete(jobId));
		this.inFlight.set(jobId, task);
		void task;
	}

	async recover(): Promise<void> {
		for (const job of await this.repository.listRecoverable()) {
			this.enqueue(job.id);
		}
	}

	async run(jobId: string): Promise<void> {
		const job = await this.repository.claim(jobId);
		if (!job) return;
		try {
			await Promise.all([
				...job.manifest.scanRunIds.map((id) =>
					this.storage.scanStorage.removeRunDirectory(id),
				),
				...job.manifest.dastRunIds.map((id) =>
					this.storage.dastStorage.removeRunDirectory(id),
				),
				...job.manifest.dynamicRunIds.map((id) =>
					this.storage.dynamicStorage.removeRunDirectory(id),
				),
				...job.manifest.reproductionRunIds.map((id) =>
					this.storage.reproductionStorage.removeRunDirectory(id),
				),
			]);
			await this.repository.complete(job.id);
		} catch (error) {
			await this.repository.fail(job.id, error);
		}
	}
}
