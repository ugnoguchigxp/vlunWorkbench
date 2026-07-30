import { and, eq, inArray, lte } from "drizzle-orm";
import type { AppDatabase } from "../../../db";
import {
	integrationIdempotencyKeys,
	integrationPreviews,
	scanReports,
	scanRuns,
} from "../../../db/schema";

type IdempotencyLookup = {
	integrationClientId: string;
	operation: string;
	idempotencyKey: string;
};

async function resourceIsActive(
	db: AppDatabase,
	resource: { resourceType: string; resourceId: string },
): Promise<boolean> {
	if (resource.resourceType === "scan_run") {
		return Boolean(
			await db.query.scanRuns.findFirst({
				where: and(
					eq(scanRuns.id, resource.resourceId),
					inArray(scanRuns.status, ["queued", "running"]),
				),
			}),
		);
	}
	if (resource.resourceType === "scan_report") {
		return Boolean(
			await db.query.scanReports.findFirst({
				where: and(
					eq(scanReports.id, resource.resourceId),
					inArray(scanReports.status, ["queued", "running"]),
				),
			}),
		);
	}
	return false;
}

export async function findRetainedIdempotency(
	db: AppDatabase,
	params: IdempotencyLookup,
) {
	const existing =
		(await db.query.integrationIdempotencyKeys.findFirst({
			where: and(
				eq(
					integrationIdempotencyKeys.integrationClientId,
					params.integrationClientId,
				),
				eq(integrationIdempotencyKeys.operation, params.operation),
				eq(integrationIdempotencyKeys.idempotencyKey, params.idempotencyKey),
			),
		})) ?? null;
	if (
		existing &&
		existing.expiresAt.getTime() <= Date.now() &&
		!(await resourceIsActive(db, existing))
	) {
		await db
			.delete(integrationIdempotencyKeys)
			.where(eq(integrationIdempotencyKeys.id, existing.id));
		return null;
	}
	return existing;
}

export async function cleanupExpiredIntegrationState(
	db: AppDatabase,
	now: Date,
): Promise<void> {
	await db
		.delete(integrationPreviews)
		.where(lte(integrationPreviews.expiresAt, now));
	const expiredKeys = await db.query.integrationIdempotencyKeys.findMany({
		where: lte(integrationIdempotencyKeys.expiresAt, now),
	});
	for (const key of expiredKeys) {
		if (await resourceIsActive(db, key)) continue;
		await db
			.delete(integrationIdempotencyKeys)
			.where(eq(integrationIdempotencyKeys.id, key.id));
	}
}
