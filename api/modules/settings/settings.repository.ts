import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppEnv } from "../../app/env";
import {
	applyRuntimeSettings,
	RUNTIME_SETTINGS_KEY,
	type RuntimeSettings,
	RuntimeSettingsBaseSchema,
	type RuntimeSettingsResponse,
	RuntimeSettingsSchema,
	RuntimeSettingsUpdateSchema,
	runtimeSettingsFromAppEnv,
} from "../../config/runtime-settings";
import type { AppDatabase } from "../../db";
import { runtimeSettings, userSettings } from "../../db/schema";
import {
	decryptRuntimeSettingsSecret,
	encryptRuntimeSettingsSecret,
} from "./runtime-settings-secret";

const GLOBAL_SYSTEM_CONTEXT_KEY = "__global_system_context__";
const LEGACY_KEYS = ["local", "global", "system"];

const PersistedRuntimeSettingsSchema = RuntimeSettingsBaseSchema.extend({
	dastAuthKeySecret: z
		.object({
			ciphertext: z.string().min(1),
			nonce: z.string().min(1),
			authTag: z.string().min(1),
			keyId: z.string().min(1),
		})
		.optional(),
});

type RuntimeSettingsSource = "environment" | "settings" | "none";

type ResolvedRuntimeSettings = {
	settings: RuntimeSettings;
	source: RuntimeSettingsSource;
};

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

	private async readRuntimeSettingsRecord() {
		return await this.db.query.runtimeSettings.findFirst({
			where: eq(runtimeSettings.id, RUNTIME_SETTINGS_KEY),
		});
	}

	private resolveRuntimeSettingsRecord(
		existing: typeof runtimeSettings.$inferSelect | undefined,
		env: AppEnv,
	): ResolvedRuntimeSettings {
		if (!existing) {
			const settings = runtimeSettingsFromAppEnv(env);
			return {
				settings,
				source: settings.dastAuthEncryptionKey ? "environment" : "none",
			};
		}

		const persisted = PersistedRuntimeSettingsSchema.parse(existing.settings);
		if (!persisted.dastAuthKeySecret) {
			return {
				settings: RuntimeSettingsSchema.parse({
					...persisted,
					dastAuthEncryptionKey: env.dastAuthEncryptionKey,
					dastAuthPreviousEncryptionKeys:
						env.dastAuthPreviousEncryptionKeys ?? [],
				}),
				source: env.dastAuthEncryptionKey ? "environment" : "none",
			};
		}

		const keys = RuntimeSettingsSchema.pick({
			dastAuthEncryptionKey: true,
			dastAuthPreviousEncryptionKeys: true,
		}).parse(
			decryptRuntimeSettingsSecret(persisted.dastAuthKeySecret, env.jwtSecret),
		);
		return {
			settings: RuntimeSettingsSchema.parse({ ...persisted, ...keys }),
			source: keys.dastAuthEncryptionKey ? "settings" : "none",
		};
	}

	private toRuntimeSettingsResponse(
		resolved: ResolvedRuntimeSettings,
		updatedAt: Date | null,
	): RuntimeSettingsResponse {
		const {
			dastAuthEncryptionKey,
			dastAuthPreviousEncryptionKeys: _previousKeys,
			...settings
		} = resolved.settings;
		return {
			...settings,
			dastAuthEncryptionKey: "",
			dastAuthEncryptionKeyConfigured: Boolean(dastAuthEncryptionKey),
			dastAuthEncryptionKeySource: resolved.source,
			updatedAt: updatedAt?.toISOString() ?? null,
		};
	}

	async getRuntimeSettings(env: AppEnv): Promise<RuntimeSettingsResponse> {
		const existing = await this.readRuntimeSettingsRecord();
		return this.toRuntimeSettingsResponse(
			this.resolveRuntimeSettingsRecord(existing, env),
			existing?.updatedAt ?? null,
		);
	}

	async resolveAppEnv(env: AppEnv): Promise<AppEnv> {
		const existing = await this.readRuntimeSettingsRecord();
		return applyRuntimeSettings(
			env,
			this.resolveRuntimeSettingsRecord(existing, env).settings,
		);
	}

	async updateRuntimeSettings(
		input: unknown,
		env: AppEnv,
	): Promise<RuntimeSettingsResponse> {
		const update = RuntimeSettingsUpdateSchema.parse(input);
		const existing = await this.readRuntimeSettingsRecord();
		const current = this.resolveRuntimeSettingsRecord(existing, env);
		const persisted = existing
			? PersistedRuntimeSettingsSchema.parse(existing.settings)
			: null;
		const requestedKey = update.dastAuthEncryptionKey;
		const secret = requestedKey
			? encryptRuntimeSettingsSecret(
					rotateDastAuthKeys(current.settings, requestedKey),
					env.jwtSecret,
				)
			: persisted?.dastAuthKeySecret;
		const { dastAuthEncryptionKey: _requestedKey, ...base } = update;
		const now = new Date();
		const [updated] = await this.db
			.insert(runtimeSettings)
			.values({
				id: RUNTIME_SETTINGS_KEY,
				settings: {
					...base,
					...(secret ? { dastAuthKeySecret: secret } : {}),
				},
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: runtimeSettings.id,
				set: {
					settings: {
						...base,
						...(secret ? { dastAuthKeySecret: secret } : {}),
					},
					updatedAt: now,
				},
			})
			.returning();
		return this.toRuntimeSettingsResponse(
			this.resolveRuntimeSettingsRecord(updated, env),
			updated.updatedAt,
		);
	}
}

function rotateDastAuthKeys(
	current: RuntimeSettings,
	requestedKey: string,
): Pick<
	RuntimeSettings,
	"dastAuthEncryptionKey" | "dastAuthPreviousEncryptionKeys"
> {
	if (requestedKey === current.dastAuthEncryptionKey) {
		return {
			dastAuthEncryptionKey: requestedKey,
			dastAuthPreviousEncryptionKeys: current.dastAuthPreviousEncryptionKeys,
		};
	}
	return {
		dastAuthEncryptionKey: requestedKey,
		dastAuthPreviousEncryptionKeys: Array.from(
			new Set(
				[
					current.dastAuthEncryptionKey,
					...current.dastAuthPreviousEncryptionKeys,
				].filter((key): key is string => Boolean(key) && key !== requestedKey),
			),
		),
	};
}
