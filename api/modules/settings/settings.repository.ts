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

	private async readGlobalRecord(): Promise<SystemContextRecord> {
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
			return { ...legacy, userId: GLOBAL_SYSTEM_CONTEXT_KEY };
		}

		const epoch = new Date(0);
		return {
			userId: GLOBAL_SYSTEM_CONTEXT_KEY,
			systemContext: "",
			createdAt: epoch,
			updatedAt: epoch,
		};
	}

	async getSystemContext(): Promise<SystemContextRecord> {
		return await this.readGlobalRecord();
	}

	async getSystemContextForUser(userId: string): Promise<SystemContextRecord> {
		const normalizedUserId = userId.trim();
		if (!normalizedUserId) {
			return this.readGlobalRecord();
		}
		if (normalizedUserId === GLOBAL_SYSTEM_CONTEXT_KEY) {
			return this.readGlobalRecord();
		}
		const userRecord = await this.db.query.userSettings.findFirst({
			where: eq(userSettings.userId, normalizedUserId),
		});
		if (userRecord) {
			return userRecord;
		}
		return this.readGlobalRecord();
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
