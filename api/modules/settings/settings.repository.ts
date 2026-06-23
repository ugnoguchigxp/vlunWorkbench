import { eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import { userSettings } from "../../db/schema";

const GLOBAL_SYSTEM_CONTEXT_KEY = "__global_system_context__";
const LEGACY_KEYS = ["local", "global", "system"];

export type SystemContextRecord = {
	userId: string;
	systemContext: string;
	createdAt: Date;
	updatedAt: Date;
};

export class SettingsRepository {
	constructor(private readonly db: AppDatabase) {}

	private async ensureGlobalRecord(): Promise<SystemContextRecord> {
		const existingGlobal = await this.db.query.userSettings.findFirst({
			where: eq(userSettings.userId, GLOBAL_SYSTEM_CONTEXT_KEY),
		});
		if (existingGlobal) {
			return existingGlobal;
		}

		for (const legacyKey of LEGACY_KEYS) {
			const legacy = await this.db.query.userSettings.findFirst({
				where: eq(userSettings.userId, legacyKey),
			});
			if (!legacy) continue;
			const now = new Date();
			const [migrated] = await this.db
				.insert(userSettings)
				.values({
					userId: GLOBAL_SYSTEM_CONTEXT_KEY,
					systemContext: legacy.systemContext,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing()
				.returning();
			if (migrated) {
				return migrated;
			}
			const retry = await this.db.query.userSettings.findFirst({
				where: eq(userSettings.userId, GLOBAL_SYSTEM_CONTEXT_KEY),
			});
			if (retry) return retry;
		}

		const now = new Date();
		const [created] = await this.db
			.insert(userSettings)
			.values({
				userId: GLOBAL_SYSTEM_CONTEXT_KEY,
				systemContext: "",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return created;
	}

	async getSystemContext(): Promise<SystemContextRecord> {
		return await this.ensureGlobalRecord();
	}

	async getSystemContextForUser(userId: string): Promise<SystemContextRecord> {
		const normalizedUserId = userId.trim();
		if (!normalizedUserId) {
			return this.ensureGlobalRecord();
		}
		if (normalizedUserId === GLOBAL_SYSTEM_CONTEXT_KEY) {
			return this.ensureGlobalRecord();
		}
		const userRecord = await this.db.query.userSettings.findFirst({
			where: eq(userSettings.userId, normalizedUserId),
		});
		if (userRecord) {
			return userRecord;
		}
		return this.ensureGlobalRecord();
	}

	async updateSystemContext(
		systemContext: string,
		userId?: string,
	): Promise<SystemContextRecord> {
		const normalizedUserId = userId?.trim();
		const targetUserId =
			normalizedUserId && normalizedUserId !== GLOBAL_SYSTEM_CONTEXT_KEY
				? normalizedUserId
				: GLOBAL_SYSTEM_CONTEXT_KEY;
		if (targetUserId === GLOBAL_SYSTEM_CONTEXT_KEY) {
			await this.ensureGlobalRecord();
		}
		const now = new Date();
		const [updated] = await this.db
			.insert(userSettings)
			.values({
				userId: targetUserId,
				systemContext,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: userSettings.userId,
				set: {
					systemContext,
					updatedAt: now,
				},
			})
			.returning();
		return updated;
	}
}
