import fs from "node:fs/promises";
import path from "node:path";
import {
	type NightworkersIntegrationScope,
	nightworkersIntegrationScopeSchema,
} from "../../../shared/schemas/nightworkers-security-scan-integration.schema";
import type { AppDatabase } from "../../db";
import {
	type IntegrationClientRecord,
	IntegrationClientRepository,
} from "./integration-client.repository";
import {
	generateIntegrationToken,
	parseIntegrationTokenPrefix,
	verifyIntegrationTokenHash,
} from "./integration-client-token";

export type AuthenticatedIntegrationClient = Omit<
	IntegrationClientRecord,
	"scopes" | "allowedRoots" | "rateLimitPolicy"
> & {
	scopes: NightworkersIntegrationScope[];
	allowedRoots: string[];
	rateLimitPolicy: {
		limit: number;
		windowMs: number;
	};
};

export class IntegrationClientAuthenticationError extends Error {
	constructor(
		readonly code: "invalid" | "inactive" | "expired",
		message: string,
	) {
		super(message);
		this.name = "IntegrationClientAuthenticationError";
	}
}

function parseScopes(values: unknown): NightworkersIntegrationScope[] {
	const parsed = nightworkersIntegrationScopeSchema.array().safeParse(values);
	if (!parsed.success) {
		throw new Error("Integration client contains invalid scopes.");
	}
	return [...new Set(parsed.data)];
}

function parseAllowedRoots(values: unknown): string[] {
	if (
		!Array.isArray(values) ||
		!values.every((value) => typeof value === "string")
	) {
		throw new Error("Integration client contains invalid allowed roots.");
	}
	return [...new Set(values.map((value) => path.resolve(value)))];
}

function parseRateLimitPolicy(value: unknown): {
	limit: number;
	windowMs: number;
} {
	if (!value || typeof value !== "object") {
		return { limit: 60, windowMs: 60_000 };
	}
	const policy = value as Record<string, unknown>;
	const limit =
		typeof policy.limit === "number" &&
		Number.isSafeInteger(policy.limit) &&
		policy.limit > 0
			? policy.limit
			: 60;
	const windowMs =
		typeof policy.windowMs === "number" &&
		Number.isSafeInteger(policy.windowMs) &&
		policy.windowMs > 0
			? policy.windowMs
			: 60_000;
	return { limit, windowMs };
}

export class IntegrationClientService {
	private readonly repository: IntegrationClientRepository;

	constructor(repositoryOrDb: IntegrationClientRepository | AppDatabase) {
		this.repository =
			repositoryOrDb instanceof IntegrationClientRepository
				? repositoryOrDb
				: new IntegrationClientRepository(repositoryOrDb);
	}

	async create(params: {
		name: string;
		ownerUserId: string;
		scopes: NightworkersIntegrationScope[];
		allowedRoots?: string[];
		rateLimitPolicy?: Record<string, unknown>;
		expiresAt?: Date | null;
	}) {
		const name = params.name.trim();
		if (!name || name.length > 120) {
			throw new Error("Integration client name must be 1-120 characters.");
		}
		const owner = await this.repository.findOwnerUser(params.ownerUserId);
		if (!owner?.isActive) {
			throw new Error("Integration client owner must be an active user.");
		}
		const scopes = parseScopes(params.scopes);
		const allowedRoots = await Promise.all(
			(params.allowedRoots ?? []).map(async (root) => {
				const canonical = await fs.realpath(path.resolve(root));
				const stat = await fs.stat(canonical);
				if (!stat.isDirectory()) {
					throw new Error(
						`Integration allowed root is not a directory: ${root}`,
					);
				}
				return canonical;
			}),
		);
		const generated = generateIntegrationToken();
		const client = await this.repository.create({
			name,
			ownerUserId: params.ownerUserId,
			tokenPrefix: generated.tokenPrefix,
			tokenHash: generated.tokenHash,
			scopes,
			allowedRoots: [...new Set(allowedRoots)],
			rateLimitPolicy: parseRateLimitPolicy(params.rateLimitPolicy),
			expiresAt: params.expiresAt,
		});
		return { client, token: generated.token };
	}

	async authenticate(
		token: string,
		options: { updateLastUsed?: boolean } = {},
	): Promise<AuthenticatedIntegrationClient> {
		const tokenPrefix = parseIntegrationTokenPrefix(token);
		if (!tokenPrefix) {
			throw new IntegrationClientAuthenticationError(
				"invalid",
				"Invalid integration credential.",
			);
		}
		const client = await this.repository.findByTokenPrefix(tokenPrefix);
		if (!client || !verifyIntegrationTokenHash(token, client.tokenHash)) {
			throw new IntegrationClientAuthenticationError(
				"invalid",
				"Invalid integration credential.",
			);
		}
		if (!client.active) {
			throw new IntegrationClientAuthenticationError(
				"inactive",
				"Integration credential is revoked.",
			);
		}
		if (client.expiresAt && client.expiresAt.getTime() <= Date.now()) {
			throw new IntegrationClientAuthenticationError(
				"expired",
				"Integration credential is expired.",
			);
		}
		const owner = await this.repository.findOwnerUser(client.ownerUserId);
		if (!owner?.isActive) {
			throw new IntegrationClientAuthenticationError(
				"inactive",
				"Integration credential owner is inactive.",
			);
		}
		if (options.updateLastUsed !== false) {
			await this.repository.touchLastUsed(client.id);
		}
		return {
			...client,
			scopes: parseScopes(client.scopes),
			allowedRoots: parseAllowedRoots(client.allowedRoots),
			rateLimitPolicy: parseRateLimitPolicy(client.rateLimitPolicy),
		};
	}

	async markUsed(id: string): Promise<void> {
		await this.repository.touchLastUsed(id);
	}

	async rotate(id: string) {
		const generated = generateIntegrationToken();
		const client = await this.repository.rotateToken({
			id,
			tokenPrefix: generated.tokenPrefix,
			tokenHash: generated.tokenHash,
		});
		if (!client) throw new Error("Integration client not found.");
		return { client, token: generated.token };
	}
}
