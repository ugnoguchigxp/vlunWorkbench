import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, or } from "drizzle-orm";
import {
	type AppDatabase,
	runInProcessDbTransaction,
	writerClientForDatabase,
} from "../../../db";
import {
	findings,
	integrationAuditLogs,
	integrationIdempotencyKeys,
	integrationPreviews,
	integrationResourceBindings,
	scanEvents,
	scanReports,
	scanRuns,
	toolRuns,
} from "../../../db/schema";
import {
	cleanupExpiredIntegrationState,
	findRetainedIdempotency,
} from "./nightworkers-idempotency-retention";

type MutationQuery = {
	toSQL(): { sql: string; params: unknown[] };
	then(
		onfulfilled?: (value: unknown) => unknown,
		onrejected?: (reason: unknown) => unknown,
	): PromiseLike<unknown>;
};

type IdempotentResult = {
	resourceId: string;
	replayed: boolean;
};

export class IntegrationScanCapacityError extends Error {
	constructor() {
		super("Integration scan concurrency limit exceeded.");
		this.name = "IntegrationScanCapacityError";
	}
}

const databaseMutationTails = new WeakMap<object, Promise<void>>();

async function withDatabaseMutationLock<T>(
	db: AppDatabase,
	callback: () => Promise<T>,
): Promise<T> {
	const key = db as object;
	const previous = databaseMutationTails.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	databaseMutationTails.set(key, tail);
	await previous.catch(() => undefined);
	try {
		return await callback();
	} finally {
		release();
		if (databaseMutationTails.get(key) === tail) {
			databaseMutationTails.delete(key);
		}
	}
}

export class NightworkersIntegrationRepository {
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
			for (const query of build(transaction as AppDatabase)) {
				await query;
			}
		});
	}

	async createPreview(params: {
		integrationClientId: string;
		projectId: string;
		selection: Record<string, unknown>;
		targetKind: string;
		resolvedProfileRef: string;
		targetDigest: string;
		sourceRevision: string | null;
		fileCount: number | null;
		warnings: string[];
		expiresAt: Date;
	}) {
		const [created] = await this.db
			.insert(integrationPreviews)
			.values(params)
			.returning();
		return created;
	}

	async findPreview(params: { id: string; integrationClientId: string }) {
		return (
			(await this.db.query.integrationPreviews.findFirst({
				where: and(
					eq(integrationPreviews.id, params.id),
					eq(
						integrationPreviews.integrationClientId,
						params.integrationClientId,
					),
				),
			})) ?? null
		);
	}

	async findIdempotency(params: {
		integrationClientId: string;
		operation: string;
		idempotencyKey: string;
	}) {
		return await findRetainedIdempotency(this.db, params);
	}

	async createIdempotentScan(params: {
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
	}): Promise<IdempotentResult> {
		return await withDatabaseMutationLock(this.db, async () => {
			return await this.createIdempotentScanLocked(params);
		});
	}

	private async createIdempotentScanLocked(params: {
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
	}): Promise<IdempotentResult> {
		const existing = await this.findIdempotency({
			integrationClientId: params.integrationClientId,
			operation: "scan_start",
			idempotencyKey: params.idempotencyKey,
		});
		if (existing) {
			if (existing.requestHash !== params.requestHash) {
				throw new IntegrationIdempotencyConflictError();
			}
			return {
				resourceId: existing.resourceId,
				replayed: true,
			};
		}
		if (
			(await this.countActiveScans(params.integrationClientId)) >=
			params.maxConcurrentScans
		) {
			throw new IntegrationScanCapacityError();
		}

		const scanRunId = randomUUID();
		const bindingId = randomUUID();
		const idempotencyId = randomUUID();
		const eventId = randomUUID();
		const now = new Date();
		try {
			await this.atomic((db) => [
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
					id: bindingId,
					integrationClientId: params.integrationClientId,
					resourceType: "scan_run",
					resourceId: scanRunId,
					projectId: params.projectId,
					ownerUserId: params.ownerUserId,
					createdAt: now,
				}) as MutationQuery,
				db.insert(integrationIdempotencyKeys).values({
					id: idempotencyId,
					integrationClientId: params.integrationClientId,
					operation: "scan_start",
					idempotencyKey: params.idempotencyKey,
					requestHash: params.requestHash,
					resourceType: "scan_run",
					resourceId: scanRunId,
					createdAt: now,
					expiresAt: params.idempotencyExpiresAt,
				}) as MutationQuery,
				db.insert(scanEvents).values({
					id: eventId,
					scanRunId,
					level: "info",
					eventType: "scan.queued",
					message: params.eventMessage,
					data: { integrationClientId: params.integrationClientId },
					createdAt: now,
				}) as MutationQuery,
			]);
			return { resourceId: scanRunId, replayed: false };
		} catch (error) {
			const raced = await this.findIdempotency({
				integrationClientId: params.integrationClientId,
				operation: "scan_start",
				idempotencyKey: params.idempotencyKey,
			});
			if (raced) {
				if (raced.requestHash !== params.requestHash) {
					throw new IntegrationIdempotencyConflictError();
				}
				return { resourceId: raced.resourceId, replayed: true };
			}
			throw error;
		}
	}

	async createIdempotentReport(params: {
		integrationClientId: string;
		ownerUserId: string;
		projectId: string;
		scanRunId: string;
		requestHash: string;
		idempotencyKey: string;
		idempotencyExpiresAt: Date;
		title: string;
		options: Record<string, unknown>;
	}): Promise<IdempotentResult> {
		return await withDatabaseMutationLock(this.db, async () => {
			return await this.createIdempotentReportLocked(params);
		});
	}

	private async createIdempotentReportLocked(params: {
		integrationClientId: string;
		ownerUserId: string;
		projectId: string;
		scanRunId: string;
		requestHash: string;
		idempotencyKey: string;
		idempotencyExpiresAt: Date;
		title: string;
		options: Record<string, unknown>;
	}): Promise<IdempotentResult> {
		const existing = await this.findIdempotency({
			integrationClientId: params.integrationClientId,
			operation: "report_start",
			idempotencyKey: params.idempotencyKey,
		});
		if (existing) {
			if (existing.requestHash !== params.requestHash) {
				throw new IntegrationIdempotencyConflictError();
			}
			return { resourceId: existing.resourceId, replayed: true };
		}
		const reportId = randomUUID();
		const bindingId = randomUUID();
		const idempotencyId = randomUUID();
		const now = new Date();
		try {
			await this.atomic((db) => [
				db.insert(scanReports).values({
					id: reportId,
					scanRunId: params.scanRunId,
					format: "markdown",
					title: params.title,
					options: params.options,
					status: "queued",
					generatedByUserId: params.ownerUserId,
					createdAt: now,
					updatedAt: now,
				}) as MutationQuery,
				db.insert(integrationResourceBindings).values({
					id: bindingId,
					integrationClientId: params.integrationClientId,
					resourceType: "scan_report",
					resourceId: reportId,
					projectId: params.projectId,
					ownerUserId: params.ownerUserId,
					createdAt: now,
				}) as MutationQuery,
				db.insert(integrationIdempotencyKeys).values({
					id: idempotencyId,
					integrationClientId: params.integrationClientId,
					operation: "report_start",
					idempotencyKey: params.idempotencyKey,
					requestHash: params.requestHash,
					resourceType: "scan_report",
					resourceId: reportId,
					createdAt: now,
					expiresAt: params.idempotencyExpiresAt,
				}) as MutationQuery,
			]);
			return { resourceId: reportId, replayed: false };
		} catch (error) {
			const raced = await this.findIdempotency({
				integrationClientId: params.integrationClientId,
				operation: "report_start",
				idempotencyKey: params.idempotencyKey,
			});
			if (raced) {
				if (raced.requestHash !== params.requestHash) {
					throw new IntegrationIdempotencyConflictError();
				}
				return { resourceId: raced.resourceId, replayed: true };
			}
			throw error;
		}
	}

	async findResourceBinding(params: {
		integrationClientId: string;
		resourceType: "scan_run" | "scan_report";
		resourceId: string;
	}) {
		return (
			(await this.db.query.integrationResourceBindings.findFirst({
				where: and(
					eq(
						integrationResourceBindings.integrationClientId,
						params.integrationClientId,
					),
					eq(integrationResourceBindings.resourceType, params.resourceType),
					eq(integrationResourceBindings.resourceId, params.resourceId),
				),
			})) ?? null
		);
	}

	async listEventsPage(params: {
		scanRunId: string;
		afterSeq: number;
		limit: number;
	}) {
		return await this.db.query.scanEvents.findMany({
			where: and(
				eq(scanEvents.scanRunId, params.scanRunId),
				gt(scanEvents.seq, params.afterSeq),
			),
			orderBy: [asc(scanEvents.seq)],
			limit: params.limit + 1,
		});
	}

	async listFindingRows(params: {
		scanRunId: string;
		limit: number;
		after?: { createdAt: Date; id: string };
		severity?: string;
		tool?: string;
	}) {
		const cursorCondition = params.after
			? or(
					gt(findings.createdAt, params.after.createdAt),
					and(
						eq(findings.createdAt, params.after.createdAt),
						gt(findings.id, params.after.id),
					),
				)
			: undefined;
		return await this.db.query.findings.findMany({
			where: and(
				eq(findings.scanRunId, params.scanRunId),
				cursorCondition,
				params.severity ? eq(findings.severity, params.severity) : undefined,
				params.tool ? eq(findings.sourceTool, params.tool) : undefined,
			),
			orderBy: [asc(findings.createdAt), asc(findings.id)],
			limit: params.limit + 1,
		});
	}

	async severityCounts(scanRunId: string) {
		return await this.db
			.select({
				severity: findings.severity,
				value: count(findings.id),
			})
			.from(findings)
			.where(eq(findings.scanRunId, scanRunId))
			.groupBy(findings.severity);
	}

	async listToolRuns(scanRunId: string) {
		return await this.db.query.toolRuns.findMany({
			where: eq(toolRuns.scanRunId, scanRunId),
			orderBy: [asc(toolRuns.createdAt), asc(toolRuns.id)],
		});
	}

	async countActiveScans(integrationClientId: string): Promise<number> {
		const [result] = await this.db
			.select({ value: count(scanRuns.id) })
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
						integrationClientId,
					),
					inArray(scanRuns.status, ["queued", "running"]),
				),
			);
		return result?.value ?? 0;
	}

	async listReportsForBoundScan(params: {
		integrationClientId: string;
		scanRunId: string;
	}) {
		return await this.db
			.select({ report: scanReports })
			.from(scanReports)
			.innerJoin(
				integrationResourceBindings,
				and(
					eq(integrationResourceBindings.resourceType, "scan_report"),
					eq(integrationResourceBindings.resourceId, scanReports.id),
					eq(
						integrationResourceBindings.integrationClientId,
						params.integrationClientId,
					),
				),
			)
			.where(eq(scanReports.scanRunId, params.scanRunId))
			.orderBy(desc(scanReports.createdAt));
	}

	async cleanupExpired(now = new Date()): Promise<void> {
		await cleanupExpiredIntegrationState(this.db, now);
	}

	async recordAudit(params: {
		integrationClientId: string;
		ownerUserId: string;
		scope: string;
		operation: string;
		requestId: string;
		projectRef?: string | null;
		pathHash?: string | null;
		idempotencyKeyHash?: string | null;
		resourceRef?: string | null;
		outcome: string;
		errorCode?: string | null;
	}): Promise<void> {
		await this.db.insert(integrationAuditLogs).values({
			...params,
			projectRef: params.projectRef ?? null,
			pathHash: params.pathHash ?? null,
			idempotencyKeyHash: params.idempotencyKeyHash ?? null,
			resourceRef: params.resourceRef ?? null,
			errorCode: params.errorCode ?? null,
		});
	}
}

export class IntegrationIdempotencyConflictError extends Error {
	constructor() {
		super("Idempotency key was already used with a different request.");
		this.name = "IntegrationIdempotencyConflictError";
	}
}
