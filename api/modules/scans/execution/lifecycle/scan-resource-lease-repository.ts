import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import type { AppDatabase } from "../../../../db";
import { scanResourceLeases } from "../../../../db/schema";

export type ScanResourceLeaseState = "active" | "released" | "quarantined";

export class ScanResourceLeaseRepository {
	constructor(private readonly db: AppDatabase) {}

	async acquire(params: {
		scanRunId: string;
		stepId: string;
		resourceType: string;
		provider: string;
		externalId: string;
		receipt?: Record<string, unknown>;
		leaseExpiresAt: Date;
	}) {
		const now = new Date();
		const values = {
			id: randomUUID(),
			scanRunId: params.scanRunId,
			stepId: params.stepId,
			resourceType: params.resourceType,
			provider: params.provider,
			externalId: params.externalId,
			state: "active" as const,
			receipt: params.receipt ?? {},
			leaseExpiresAt: params.leaseExpiresAt,
			releasedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		await this.db
			.insert(scanResourceLeases)
			.values(values)
			.onConflictDoUpdate({
				target: [scanResourceLeases.provider, scanResourceLeases.externalId],
				set: {
					scanRunId: values.scanRunId,
					stepId: values.stepId,
					resourceType: values.resourceType,
					state: values.state,
					receipt: values.receipt,
					leaseExpiresAt: values.leaseExpiresAt,
					releasedAt: null,
					updatedAt: now,
				},
			});
		return await this.findByResource(params.provider, params.externalId);
	}

	async release(id: string, receipt?: Record<string, unknown>) {
		const now = new Date();
		await this.db
			.update(scanResourceLeases)
			.set({
				state: "released",
				receipt: receipt ?? {},
				releasedAt: now,
				updatedAt: now,
			})
			.where(eq(scanResourceLeases.id, id));
		return await this.findById(id);
	}

	/**
	 * Runtime bundles append private child resource references immediately after
	 * creation and before start. A terminal lease must never be resurrected.
	 */
	async updateActiveReceipt(id: string, receipt: Record<string, unknown>) {
		const now = new Date();
		const updated = await this.db
			.update(scanResourceLeases)
			.set({ receipt, updatedAt: now })
			.where(
				and(
					eq(scanResourceLeases.id, id),
					eq(scanResourceLeases.state, "active"),
				),
			)
			.returning({ id: scanResourceLeases.id });
		if (updated.length !== 1) {
			throw new Error("runtime_bundle_receipt_persistence_failed");
		}
		return await this.findById(id);
	}

	async quarantine(id: string, receipt?: Record<string, unknown>) {
		const now = new Date();
		await this.db
			.update(scanResourceLeases)
			.set({ state: "quarantined", receipt: receipt ?? {}, updatedAt: now })
			.where(eq(scanResourceLeases.id, id));
		return await this.findById(id);
	}

	async listRecoverable(now = new Date(), provider?: string) {
		const recoverable = and(
			eq(scanResourceLeases.state, "active"),
			or(
				lt(scanResourceLeases.leaseExpiresAt, now),
				isNull(scanResourceLeases.leaseExpiresAt),
			),
		);
		return await this.db
			.select()
			.from(scanResourceLeases)
			.where(
				provider
					? and(recoverable, eq(scanResourceLeases.provider, provider))
					: recoverable,
			);
	}

	private async findById(id: string) {
		return (
			(await this.db.query.scanResourceLeases.findFirst({
				where: eq(scanResourceLeases.id, id),
			})) ?? null
		);
	}

	private async findByResource(provider: string, externalId: string) {
		return (
			(await this.db.query.scanResourceLeases.findFirst({
				where: and(
					eq(scanResourceLeases.provider, provider),
					eq(scanResourceLeases.externalId, externalId),
				),
			})) ?? null
		);
	}
}
