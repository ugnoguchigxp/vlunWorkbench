import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../../db";
import {
	integrationIdempotencyKeys,
	integrationResourceBindings,
	nightworkersWorkspaceTargetGrants,
	scanEvents,
	scanRuns,
} from "../../../db/schema";

type MutationQuery = {
	toSQL(): { sql: string; params: unknown[] };
	then(
		onfulfilled?: (value: unknown) => unknown,
		onrejected?: (reason: unknown) => unknown,
	): PromiseLike<unknown>;
};

const mutationTails = new WeakMap<object, Promise<void>>();

async function withMutationLock<T>(
	db: AppDatabase,
	callback: () => Promise<T>,
): Promise<T> {
	const key = db as object;
	const previous = mutationTails.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	mutationTails.set(key, tail);
	await previous.catch(() => undefined);
	try {
		return await callback();
	} finally {
		release();
		if (mutationTails.get(key) === tail) mutationTails.delete(key);
	}
}

export class NightworkersWorkspaceTargetGrantRepository {
	constructor(private readonly db: AppDatabase) {}

	private async atomic(
		build: (db: AppDatabase) => MutationQuery[],
	): Promise<void> {
		const writer = writerClientForDatabase(this.db);
		if (writer) {
			await writer.atomicDrizzleBatch(build(this.db));
			return;
		}
		await runInProcessDbTransaction(this.db, async (transaction) => {
			for (const query of build(transaction as AppDatabase)) await query;
		});
	}

	async create(params: {
		grantRef: string;
		grantDigest: string;
		integrationClientId: string;
		ownerUserId: string;
		projectId: string;
		workspaceSubjectRef: string;
		canonicalWorkspacePath: string;
		expectedGitCommonDirDigest: string;
		expectedHeadSha: string;
		providerWorkspaceStateDigest: string;
		expiresAt: Date;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(nightworkersWorkspaceTargetGrants)
			.values({ ...params, createdAt: now, updatedAt: now })
			.returning();
		if (!created) throw new Error("workspace grant was not persisted");
		return created;
	}

	async clearExpiredWorkspacePaths(now = new Date()): Promise<void> {
		await this.db
			.update(nightworkersWorkspaceTargetGrants)
			.set({ canonicalWorkspacePath: "", updatedAt: now })
			.where(
				and(
					lte(nightworkersWorkspaceTargetGrants.expiresAt, now),
					sql`${nightworkersWorkspaceTargetGrants.canonicalWorkspacePath} <> ''`,
				),
			);
	}

	async clearWorkspacePathForScan(params: {
		grantRef: string;
		scanRunId: string;
	}): Promise<void> {
		await this.db
			.update(nightworkersWorkspaceTargetGrants)
			.set({ canonicalWorkspacePath: "", updatedAt: new Date() })
			.where(
				and(
					eq(nightworkersWorkspaceTargetGrants.grantRef, params.grantRef),
					eq(
						nightworkersWorkspaceTargetGrants.consumedScanRunId,
						params.scanRunId,
					),
				),
			);
	}

	async findForClient(params: {
		grantRef: string;
		integrationClientId: string;
	}) {
		return (
			(await this.db.query.nightworkersWorkspaceTargetGrants.findFirst({
				where: and(
					eq(nightworkersWorkspaceTargetGrants.grantRef, params.grantRef),
					eq(
						nightworkersWorkspaceTargetGrants.integrationClientId,
						params.integrationClientId,
					),
				),
			})) ?? null
		);
	}

	async savePreview(params: {
		grantId: string;
		expectedRevision: number;
		previewRef: string;
		selection: Record<string, unknown>;
		targetDigest: string;
		sourceRevision: string;
		workspaceStateDigest: string;
		expiresAt: Date;
	}) {
		return await withMutationLock(this.db, async () => {
			const now = new Date();
			const [updated] = await this.db
				.update(nightworkersWorkspaceTargetGrants)
				.set({
					previewRef: params.previewRef,
					previewSelection: params.selection,
					previewTargetDigest: params.targetDigest,
					previewSourceRevision: params.sourceRevision,
					previewWorkspaceStateDigest: params.workspaceStateDigest,
					previewExpiresAt: params.expiresAt,
					revision: sql`${nightworkersWorkspaceTargetGrants.revision} + 1`,
					updatedAt: now,
				})
				.where(
					and(
						eq(nightworkersWorkspaceTargetGrants.id, params.grantId),
						eq(
							nightworkersWorkspaceTargetGrants.revision,
							params.expectedRevision,
						),
						isNull(nightworkersWorkspaceTargetGrants.consumedAt),
						gt(nightworkersWorkspaceTargetGrants.expiresAt, now),
					),
				)
				.returning();
			return updated ?? null;
		});
	}

	async consumeAndCreateScan(params: {
		grantId: string;
		grantRef: string;
		expectedRevision: number;
		integrationClientId: string;
		ownerUserId: string;
		projectId: string;
		profileRef: string;
		requestHash: string;
		idempotencyKey: string;
		idempotencyExpiresAt: Date;
		metadata: Record<string, unknown>;
		eventMessage: string;
		maxConcurrentScans: number;
	}): Promise<{ resourceId: string; replayed: boolean }> {
		return await withMutationLock(this.db, async () => {
			const replay = await this.findStartIdempotency({
				integrationClientId: params.integrationClientId,
				idempotencyKey: params.idempotencyKey,
			});
			if (replay) {
				if (replay.requestHash !== params.requestHash) {
					throw new WorkspaceGrantIdempotencyConflictError();
				}
				return { resourceId: replay.resourceId, replayed: true };
			}
			const consumed = await this.findConsumption({
				integrationClientId: params.integrationClientId,
				grantRef: params.grantRef,
			});
			if (consumed) {
				if (consumed.requestHash !== params.requestHash) {
					throw new WorkspaceGrantAlreadyConsumedError();
				}
				return { resourceId: consumed.resourceId, replayed: true };
			}
			const currentGrant = await this.findGrantForMutation(params.grantId);
			if (
				!currentGrant ||
				currentGrant.grantRef !== params.grantRef ||
				currentGrant.integrationClientId !== params.integrationClientId ||
				currentGrant.ownerUserId !== params.ownerUserId ||
				currentGrant.projectId !== params.projectId ||
				currentGrant.revision !== params.expectedRevision ||
				currentGrant.consumedAt ||
				currentGrant.expiresAt.getTime() <= Date.now()
			) {
				throw new WorkspaceGrantChangedError();
			}
			const [active] = await this.db
				.select({ value: count() })
				.from(integrationResourceBindings)
				.innerJoin(
					scanRuns,
					and(
						eq(integrationResourceBindings.resourceType, "scan_run"),
						eq(integrationResourceBindings.resourceId, scanRuns.id),
					),
				)
				.where(
					and(
						eq(
							integrationResourceBindings.integrationClientId,
							params.integrationClientId,
						),
						inArray(scanRuns.status, ["queued", "running"]),
					),
				);
			if ((active?.value ?? 0) >= params.maxConcurrentScans) {
				throw new WorkspaceGrantCapacityError();
			}
			const scanRunId = randomUUID();
			const now = new Date();
			try {
				await this.atomic((db) => [
					db
						.update(nightworkersWorkspaceTargetGrants)
						.set({
							consumedRequestHash: params.requestHash,
							consumedScanRunId: scanRunId,
							consumedAt: now,
							revision: sql`${nightworkersWorkspaceTargetGrants.revision} + 1`,
							updatedAt: now,
						})
						.where(
							and(
								eq(nightworkersWorkspaceTargetGrants.id, params.grantId),
								eq(
									nightworkersWorkspaceTargetGrants.revision,
									params.expectedRevision,
								),
								isNull(nightworkersWorkspaceTargetGrants.consumedAt),
								gt(nightworkersWorkspaceTargetGrants.expiresAt, now),
								eq(nightworkersWorkspaceTargetGrants.grantRef, params.grantRef),
								eq(
									nightworkersWorkspaceTargetGrants.integrationClientId,
									params.integrationClientId,
								),
								eq(
									nightworkersWorkspaceTargetGrants.ownerUserId,
									params.ownerUserId,
								),
								eq(
									nightworkersWorkspaceTargetGrants.projectId,
									params.projectId,
								),
							),
						) as MutationQuery,
					db.insert(scanRuns).values({
						id: scanRunId,
						projectId: params.projectId,
						profile: params.profileRef,
						status: "queued",
						createdByUserId: params.ownerUserId,
						metadata: params.metadata,
						createdAt: now,
						updatedAt: now,
					}) as MutationQuery,
					db.insert(integrationResourceBindings).values({
						id: randomUUID(),
						integrationClientId: params.integrationClientId,
						resourceType: "scan_run",
						resourceId: scanRunId,
						projectId: params.projectId,
						ownerUserId: params.ownerUserId,
						createdAt: now,
					}) as MutationQuery,
					db.insert(integrationIdempotencyKeys).values([
						{
							id: randomUUID(),
							integrationClientId: params.integrationClientId,
							operation: "workspace_grant_consume",
							idempotencyKey: params.grantRef,
							requestHash: params.requestHash,
							resourceType: "scan_run",
							resourceId: scanRunId,
							createdAt: now,
							expiresAt: params.idempotencyExpiresAt,
						},
						{
							id: randomUUID(),
							integrationClientId: params.integrationClientId,
							operation: "workspace_scan_start",
							idempotencyKey: params.idempotencyKey,
							requestHash: params.requestHash,
							resourceType: "scan_run",
							resourceId: scanRunId,
							createdAt: now,
							expiresAt: params.idempotencyExpiresAt,
						},
					]) as MutationQuery,
					db.insert(scanEvents).values({
						id: randomUUID(),
						scanRunId,
						level: "info",
						eventType: "scan.queued",
						message: params.eventMessage,
						data: {
							integrationClientId: params.integrationClientId,
							workspaceTargetGrantRef: params.grantRef,
						},
						createdAt: now,
					}) as MutationQuery,
				]);
			} catch (error) {
				const replayAfterRace = await this.findStartIdempotency({
					integrationClientId: params.integrationClientId,
					idempotencyKey: params.idempotencyKey,
				});
				if (replayAfterRace) {
					if (replayAfterRace.requestHash !== params.requestHash) {
						throw new WorkspaceGrantIdempotencyConflictError();
					}
					return {
						resourceId: replayAfterRace.resourceId,
						replayed: true,
					};
				}
				const consumptionAfterRace = await this.findConsumption({
					integrationClientId: params.integrationClientId,
					grantRef: params.grantRef,
				});
				if (consumptionAfterRace) {
					if (consumptionAfterRace.requestHash !== params.requestHash) {
						throw new WorkspaceGrantAlreadyConsumedError();
					}
					return {
						resourceId: consumptionAfterRace.resourceId,
						replayed: true,
					};
				}
				const grantAfterRace = await this.findGrantForMutation(params.grantId);
				if (
					!grantAfterRace ||
					grantAfterRace.revision !== params.expectedRevision ||
					grantAfterRace.consumedAt ||
					grantAfterRace.expiresAt.getTime() <= Date.now()
				) {
					throw new WorkspaceGrantChangedError();
				}
				throw error;
			}
			return { resourceId: scanRunId, replayed: false };
		});
	}

	private async findGrantForMutation(grantId: string) {
		return (
			(await this.db.query.nightworkersWorkspaceTargetGrants.findFirst({
				where: eq(nightworkersWorkspaceTargetGrants.id, grantId),
			})) ?? null
		);
	}

	private async findStartIdempotency(params: {
		integrationClientId: string;
		idempotencyKey: string;
	}) {
		return (
			(await this.db.query.integrationIdempotencyKeys.findFirst({
				where: and(
					eq(
						integrationIdempotencyKeys.integrationClientId,
						params.integrationClientId,
					),
					eq(integrationIdempotencyKeys.operation, "workspace_scan_start"),
					eq(integrationIdempotencyKeys.idempotencyKey, params.idempotencyKey),
					gt(integrationIdempotencyKeys.expiresAt, new Date()),
				),
			})) ?? null
		);
	}

	private async findConsumption(params: {
		integrationClientId: string;
		grantRef: string;
	}) {
		return (
			(await this.db.query.integrationIdempotencyKeys.findFirst({
				where: and(
					eq(
						integrationIdempotencyKeys.integrationClientId,
						params.integrationClientId,
					),
					eq(integrationIdempotencyKeys.operation, "workspace_grant_consume"),
					eq(integrationIdempotencyKeys.idempotencyKey, params.grantRef),
					gt(integrationIdempotencyKeys.expiresAt, new Date()),
				),
			})) ?? null
		);
	}
}

export class WorkspaceGrantIdempotencyConflictError extends Error {}
export class WorkspaceGrantAlreadyConsumedError extends Error {}
export class WorkspaceGrantCapacityError extends Error {}
export class WorkspaceGrantChangedError extends Error {}
