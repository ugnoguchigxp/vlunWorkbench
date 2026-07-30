import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	type CreateDastAuthContextInput,
	type DastAuthSecretPayload,
	dastAuthSecretPayloadSchema,
	dastLoginActionSchema,
} from "../../../shared/schemas/dast-auth.schema";
import type { AppDatabase } from "../../db";
import {
	dastAuthAuditEvents,
	dastAuthContexts,
	dastTargetConfigs,
	dastTestIdentities,
} from "../../db/schema";
import type {
	DastAuthContextCrypto,
	DastAuthIdentity,
} from "./auth-context-crypto";
import { assertAuthSecretTargetsOrigin } from "./auth-target-policy";

export class DastAuthContextRepository {
	constructor(
		private readonly db: AppDatabase,
		private readonly crypto: DastAuthContextCrypto,
	) {}

	async create(
		input: CreateDastAuthContextInput & {
			projectId: string;
			createdByUserId: string;
		},
	) {
		await this.assertSecretTarget(
			input.projectId,
			input.targetConfigId,
			input.secret,
		);
		if (Date.parse(input.expiresAt) <= Date.now()) {
			throw new Error("DAST auth context expiry must be in the future.");
		}
		const contextId = randomUUID();
		const testIdentity = await this.findOrCreateIdentity({
			projectId: input.projectId,
			targetConfigId: input.targetConfigId,
			role: input.identityRole,
			label: input.label,
			createdByUserId: input.createdByUserId,
		});
		const identity = identityFor({
			id: contextId,
			projectId: input.projectId,
			targetConfigId: input.targetConfigId,
			identityRole: input.identityRole,
			authKind: input.secret.kind,
		});
		const encrypted = this.crypto.encrypt(input.secret, identity);
		const now = new Date();
		const [created] = await this.db
			.insert(dastAuthContexts)
			.values({
				id: contextId,
				projectId: input.projectId,
				targetConfigId: input.targetConfigId,
				testIdentityId: testIdentity.id,
				identityRole: input.identityRole,
				label: input.label,
				authKind: input.secret.kind,
				secretCiphertext: encrypted.ciphertext,
				secretNonce: encrypted.nonce,
				secretAuthTag: encrypted.authTag,
				secretKeyId: encrypted.keyId,
				loginFlow: input.loginFlow,
				status: "active",
				expiresAt: new Date(input.expiresAt),
				createdByUserId: input.createdByUserId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		await this.audit(created, "created", input.createdByUserId);
		return sanitizeContext(created);
	}

	async list(projectId: string) {
		const rows = await this.db.query.dastAuthContexts.findMany({
			where: eq(dastAuthContexts.projectId, projectId),
			orderBy: (fields, { desc }) => [desc(fields.createdAt)],
		});
		return rows.map(sanitizeContext);
	}

	async get(id: string, projectId: string) {
		const row = await this.findOwned(id, projectId);
		return row ? sanitizeContext(row) : null;
	}

	async rotate(params: {
		id: string;
		projectId: string;
		secret: DastAuthSecretPayload;
		expiresAt: string;
		actorUserId: string;
	}) {
		const current = await this.findOwned(params.id, params.projectId);
		if (!current) return null;
		if (current.status === "revoked") {
			throw new Error("Revoked DAST auth contexts cannot be rotated.");
		}
		if (params.secret.kind !== current.authKind) {
			throw new Error("Auth kind cannot change during rotation.");
		}
		await this.assertSecretTarget(
			params.projectId,
			current.targetConfigId,
			params.secret,
		);
		if (Date.parse(params.expiresAt) <= Date.now()) {
			throw new Error("DAST auth context expiry must be in the future.");
		}
		const encrypted = this.crypto.encrypt(params.secret, identityFor(current));
		const now = new Date();
		const [updated] = await this.db
			.update(dastAuthContexts)
			.set({
				secretCiphertext: encrypted.ciphertext,
				secretNonce: encrypted.nonce,
				secretAuthTag: encrypted.authTag,
				secretKeyId: encrypted.keyId,
				expiresAt: new Date(params.expiresAt),
				rotatedAt: now,
				updatedAt: now,
			})
			.where(eq(dastAuthContexts.id, current.id))
			.returning();
		await this.audit(updated, "rotated", params.actorUserId);
		return sanitizeContext(updated);
	}

	async revoke(id: string, projectId: string, actorUserId: string) {
		const [updated] = await this.db
			.update(dastAuthContexts)
			.set({ status: "revoked", revokedAt: new Date(), updatedAt: new Date() })
			.where(
				and(
					eq(dastAuthContexts.id, id),
					eq(dastAuthContexts.projectId, projectId),
				),
			)
			.returning();
		if (!updated) return null;
		await this.audit(updated, "revoked", actorUserId);
		return sanitizeContext(updated);
	}

	async decryptForUse(params: {
		id: string;
		projectId: string;
		targetConfigId: string;
		identityRole: string;
		actorUserId?: string;
	}) {
		const row = await this.findOwned(params.id, params.projectId);
		if (!row) throw new Error("DAST auth context not found.");
		if (
			row.targetConfigId !== params.targetConfigId ||
			row.identityRole !== params.identityRole
		) {
			throw new Error("DAST auth context identity does not match the target.");
		}
		if (row.status !== "active")
			throw new Error("DAST auth context is revoked.");
		if (row.expiresAt.getTime() <= Date.now()) {
			throw new Error("DAST auth context is expired.");
		}
		const payload = dastAuthSecretPayloadSchema.parse(
			this.crypto.decrypt(
				{
					ciphertext: row.secretCiphertext,
					nonce: row.secretNonce,
					authTag: row.secretAuthTag,
					keyId: row.secretKeyId,
				},
				identityFor(row),
			),
		);
		await this.audit(row, "used", params.actorUserId ?? null);
		return {
			context: {
				...sanitizeContext(row),
				loginFlow: dastLoginActionSchema.array().parse(row.loginFlow),
			},
			secret: payload,
		};
	}

	private async findOwned(id: string, projectId: string) {
		return (
			(await this.db.query.dastAuthContexts.findFirst({
				where: and(
					eq(dastAuthContexts.id, id),
					eq(dastAuthContexts.projectId, projectId),
				),
			})) ?? null
		);
	}

	private async assertSecretTarget(
		projectId: string,
		targetConfigId: string,
		secret: DastAuthSecretPayload,
	) {
		const target = await this.db.query.dastTargetConfigs.findFirst({
			where: and(
				eq(dastTargetConfigs.id, targetConfigId),
				eq(dastTargetConfigs.projectId, projectId),
			),
		});
		if (!target) throw new Error("DAST target config not found.");
		assertAuthSecretTargetsOrigin(secret, target.normalizedOrigin);
	}

	private async findOrCreateIdentity(params: {
		projectId: string;
		targetConfigId: string;
		role: string;
		label: string;
		createdByUserId: string;
	}) {
		await this.db
			.insert(dastTestIdentities)
			.values({
				...params,
				enabled: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.onConflictDoNothing({
				target: [
					dastTestIdentities.projectId,
					dastTestIdentities.targetConfigId,
					dastTestIdentities.role,
				],
			});
		const identity = await this.db.query.dastTestIdentities.findFirst({
			where: and(
				eq(dastTestIdentities.projectId, params.projectId),
				eq(dastTestIdentities.targetConfigId, params.targetConfigId),
				eq(dastTestIdentities.role, params.role),
			),
		});
		if (!identity)
			throw new Error("DAST test identity could not be persisted.");
		return identity;
	}

	private async audit(
		row: {
			id: string;
			projectId: string;
			targetConfigId: string;
			identityRole: string;
			authKind: string;
		},
		eventType: string,
		actorUserId: string | null,
	) {
		await this.db.insert(dastAuthAuditEvents).values({
			projectId: row.projectId,
			authContextId: row.id,
			eventType,
			actorUserId,
			metadata: {
				targetConfigId: row.targetConfigId,
				identityRole: row.identityRole,
				authKind: row.authKind,
			},
			createdAt: new Date(),
		});
	}
}

function identityFor(row: {
	id: string;
	projectId: string;
	targetConfigId: string;
	identityRole: string;
	authKind: string;
}): DastAuthIdentity {
	return {
		contextId: row.id,
		projectId: row.projectId,
		targetConfigId: row.targetConfigId,
		identityRole: row.identityRole,
		authKind: row.authKind,
	};
}

function sanitizeContext<
	T extends {
		secretCiphertext: string;
		secretNonce: string;
		secretAuthTag: string;
		secretKeyId: string;
	},
>(row: T) {
	const {
		secretCiphertext: _ciphertext,
		secretNonce: _nonce,
		secretAuthTag: _authTag,
		secretKeyId: _keyId,
		...safe
	} = row;
	return safe;
}
