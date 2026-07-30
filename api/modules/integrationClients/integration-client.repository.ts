import { and, desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	integrationAuditLogs,
	integrationClients,
	users,
} from "../../db/schema";

export class IntegrationClientRepository {
	constructor(private readonly db: AppDatabase) {}

	async create(params: {
		name: string;
		ownerUserId: string;
		tokenPrefix: string;
		tokenHash: string;
		scopes: string[];
		allowedRoots: string[];
		rateLimitPolicy?: Record<string, unknown>;
		expiresAt?: Date | null;
	}) {
		const now = new Date();
		const [created] = await this.db
			.insert(integrationClients)
			.values({
				name: params.name,
				ownerUserId: params.ownerUserId,
				tokenPrefix: params.tokenPrefix,
				tokenHash: params.tokenHash,
				scopes: params.scopes,
				allowedRoots: params.allowedRoots,
				rateLimitPolicy: params.rateLimitPolicy ?? {},
				active: true,
				expiresAt: params.expiresAt ?? null,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async findById(id: string) {
		return (
			(await this.db.query.integrationClients.findFirst({
				where: eq(integrationClients.id, id),
			})) ?? null
		);
	}

	async findOwnerUser(id: string) {
		return (
			(await this.db.query.users.findFirst({
				where: eq(users.id, id),
			})) ?? null
		);
	}

	async findByTokenPrefix(tokenPrefix: string) {
		return (
			(await this.db.query.integrationClients.findFirst({
				where: eq(integrationClients.tokenPrefix, tokenPrefix),
			})) ?? null
		);
	}

	async list(ownerUserId?: string) {
		return await this.db.query.integrationClients.findMany({
			where: ownerUserId
				? eq(integrationClients.ownerUserId, ownerUserId)
				: undefined,
			orderBy: [desc(integrationClients.createdAt)],
		});
	}

	async revoke(id: string) {
		const [updated] = await this.db
			.update(integrationClients)
			.set({ active: false, updatedAt: new Date() })
			.where(
				and(eq(integrationClients.id, id), eq(integrationClients.active, true)),
			)
			.returning();
		return updated ?? (await this.findById(id));
	}

	async rotateToken(params: {
		id: string;
		tokenPrefix: string;
		tokenHash: string;
	}) {
		const [updated] = await this.db
			.update(integrationClients)
			.set({
				tokenPrefix: params.tokenPrefix,
				tokenHash: params.tokenHash,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(integrationClients.id, params.id),
					eq(integrationClients.active, true),
				),
			)
			.returning();
		return updated ?? null;
	}

	async touchLastUsed(id: string, usedAt = new Date()): Promise<void> {
		await this.db
			.update(integrationClients)
			.set({ lastUsedAt: usedAt, updatedAt: usedAt })
			.where(eq(integrationClients.id, id));
	}

	async createAuditLog(params: {
		integrationClientId?: string | null;
		ownerUserId?: string | null;
		scope?: string | null;
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
			integrationClientId: params.integrationClientId ?? null,
			ownerUserId: params.ownerUserId ?? null,
			scope: params.scope ?? null,
			operation: params.operation,
			requestId: params.requestId,
			projectRef: params.projectRef ?? null,
			pathHash: params.pathHash ?? null,
			idempotencyKeyHash: params.idempotencyKeyHash ?? null,
			resourceRef: params.resourceRef ?? null,
			outcome: params.outcome,
			errorCode: params.errorCode ?? null,
		});
	}
}

export type IntegrationClientRecord = NonNullable<
	Awaited<ReturnType<IntegrationClientRepository["findById"]>>
>;
