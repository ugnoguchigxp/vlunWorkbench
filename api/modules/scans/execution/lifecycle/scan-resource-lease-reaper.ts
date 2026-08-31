import type { ScanResourceLeaseRepository } from "./scan-resource-lease-repository";

/** Reclaims expired external resources and records a recoverable quarantine. */
export class ScanResourceLeaseReaper {
	constructor(
		private readonly repository: ScanResourceLeaseRepository,
		private readonly cleanup: (lease: {
			id: string;
			provider: string;
			externalId: string;
			resourceType: string;
			receipt: Record<string, unknown>;
		}) => Promise<void>,
		private readonly provider?: string,
	) {}

	async reap(
		now = new Date(),
	): Promise<{ released: number; quarantined: number }> {
		let released = 0;
		let quarantined = 0;
		for (const lease of await this.repository.listRecoverable(
			now,
			this.provider,
		)) {
			try {
				await this.cleanup(lease);
				await this.repository.release(lease.id, {
					reapedAt: now.toISOString(),
				});
				released++;
			} catch (error) {
				await this.repository.quarantine(lease.id, {
					reasonCode: "cleanup_failed",
					errorType:
						error instanceof Error ? error.name : "UnknownCleanupError",
				});
				quarantined++;
			}
		}
		return { released, quarantined };
	}
}
