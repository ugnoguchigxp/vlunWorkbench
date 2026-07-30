import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { users } from "../../db/schema";
import { IntegrationClientRepository } from "./integration-client.repository";
import { IntegrationClientService } from "./integration-client.service";

describe("IntegrationClientService lifecycle", () => {
	let connection: DbConnection;
	let repository: IntegrationClientRepository;
	let service: IntegrationClientService;
	let allowedRoot: string;
	let ownerUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDirectory)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
			);
		}
		allowedRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "vulnworkbench-integration-client-"),
		);
		const now = new Date("2026-07-30T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "integration-lifecycle@example.com",
				passwordHash: "hash",
				displayName: "Integration owner",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		ownerUserId = owner.id;
		repository = new IntegrationClientRepository(connection.db);
		service = new IntegrationClientService(repository);
	});

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(allowedRoot, { recursive: true, force: true });
	});

	it("stores only a token hash and invalidates the old token on rotation", async () => {
		const created = await service.create({
			name: "nightworkers",
			ownerUserId,
			scopes: ["nightworkers:security-scan:read"],
			allowedRoots: [allowedRoot],
		});
		const stored = await repository.findById(created.client.id);
		expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(stored?.tokenHash).not.toContain(created.token);
		expect((await service.authenticate(created.token)).id).toBe(
			created.client.id,
		);

		const rotated = await service.rotate(created.client.id);
		expect(rotated.client.id).toBe(created.client.id);
		await expect(service.authenticate(created.token)).rejects.toMatchObject({
			code: "invalid",
		});
		expect((await service.authenticate(rotated.token)).id).toBe(
			created.client.id,
		);
	});

	it("rejects expired and revoked credentials and cannot rotate a revoked client", async () => {
		const expired = await service.create({
			name: "expired",
			ownerUserId,
			scopes: ["nightworkers:security-scan:read"],
			allowedRoots: [allowedRoot],
			expiresAt: new Date(Date.now() - 1_000),
		});
		await expect(service.authenticate(expired.token)).rejects.toMatchObject({
			code: "expired",
		});

		const created = await service.create({
			name: "revoked",
			ownerUserId,
			scopes: ["nightworkers:security-scan:read"],
			allowedRoots: [allowedRoot],
		});
		await repository.revoke(created.client.id);
		await expect(service.authenticate(created.token)).rejects.toMatchObject({
			code: "inactive",
		});
		await expect(service.rotate(created.client.id)).rejects.toThrow(
			"Integration client not found.",
		);
	});

	it("requires an active owner and canonicalizes allowed roots", async () => {
		const [inactiveOwner] = await connection.db
			.insert(users)
			.values({
				email: "inactive-lifecycle@example.com",
				passwordHash: "hash",
				displayName: "Inactive owner",
				role: "member",
				isActive: false,
			})
			.returning();
		await expect(
			service.create({
				name: "invalid-owner",
				ownerUserId: inactiveOwner.id,
				scopes: ["nightworkers:security-scan:read"],
			}),
		).rejects.toThrow("active user");

		const created = await service.create({
			name: "canonical-root",
			ownerUserId,
			scopes: ["nightworkers:security-scan:read"],
			allowedRoots: [path.join(allowedRoot, ".")],
		});
		expect(created.client.allowedRoots).toEqual([await fs.realpath(allowedRoot)]);

		await connection.db
			.update(users)
			.set({ isActive: false })
			.where(eq(users.id, ownerUserId));
		await expect(service.authenticate(created.token)).rejects.toMatchObject({
			code: "inactive",
		});
	});
});
