import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { dastAuthAuditEvents, dastAuthContexts, dastTargetConfigs, projects, users } from "../../db/schema";
import { DastAuthContextCrypto } from "./auth-context-crypto";
import { DastAuthContextRepository } from "./auth-context-repository";

describe("DastAuthContextRepository", () => {
	let connection: DbConnection;
	let repository: DastAuthContextRepository;
	let projectId: string;
	let targetConfigId: string;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		for (const file of readdirSync(path.resolve("drizzle"))
			.filter((name) => name.endsWith(".sql"))
			.sort()) {
			connection.sqlite.exec(readFileSync(path.resolve("drizzle", file), "utf8"));
		}
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "auth-context@example.com",
				passwordHash: "hash",
				displayName: "Auth context",
				role: "member",
				isActive: true,
			})
			.returning();
		userId = user.id;
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user.id,
				name: "Auth target",
				repoPath: "/tmp/auth-target",
				canonicalRepoPath: "/tmp/auth-target",
			})
			.returning();
		projectId = project.id;
		const [target] = await connection.db
			.insert(dastTargetConfigs)
			.values({
				projectId,
				name: "local",
				origin: "http://127.0.0.1:3000",
				normalizedOrigin: "http://127.0.0.1:3000",
			})
			.returning();
		targetConfigId = target.id;
		repository = new DastAuthContextRepository(
			connection.db,
			new DastAuthContextCrypto(Buffer.alloc(32, 9).toString("base64")),
		);
	});

	afterEach(() => connection.sqlite.close());

	it("stores no credential plaintext and returns only sanitized metadata", async () => {
		const created = await repository.create({
			projectId,
			targetConfigId,
			identityRole: "user-a",
			label: "User A",
			secret: { kind: "bearer_token", token: "credential-canary" },
			loginFlow: [],
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			createdByUserId: userId,
		});
		expect(JSON.stringify(created)).not.toContain("credential-canary");
		const [row] = await connection.db.select().from(dastAuthContexts);
		expect(JSON.stringify(row)).not.toContain("credential-canary");
		const decrypted = await repository.decryptForUse({
			id: created.id,
			projectId,
			targetConfigId,
			identityRole: "user-a",
			actorUserId: userId,
		});
		expect(decrypted.secret).toMatchObject({ token: "credential-canary" });
		expect(await connection.db.select().from(dastAuthAuditEvents)).toHaveLength(
			2,
		);
	});

	it("binds API use to the configured target origin", async () => {
		const created = await repository.create({
			projectId,
			targetConfigId,
			identityRole: "api-user",
			label: "API user",
			secret: { kind: "named_header", name: "X-Api-Key", value: "canary" },
			loginFlow: [],
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			createdByUserId: userId,
		});
		await expect(
			repository.decryptForOriginUse({
				id: created.id,
				projectId,
				targetOrigin: "http://127.0.0.1:3000",
				identityRole: "api-user",
			}),
		).resolves.toMatchObject({ secret: { value: "canary" } });
		await expect(
			repository.decryptForOriginUse({
				id: created.id,
				projectId,
				targetOrigin: "http://127.0.0.1:3001",
				identityRole: "api-user",
			}),
		).rejects.toThrow("does not match");
	});

	it("revalidates credential scope after a target origin changes", async () => {
		const created = await repository.create({
			projectId,
			targetConfigId,
			identityRole: "cookie-user",
			label: "Cookie user",
			secret: {
				kind: "cookie_set",
				cookies: [
					{
						name: "session",
						value: "cookie-canary",
						domain: "127.0.0.1",
					},
				],
			},
			loginFlow: [],
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			createdByUserId: userId,
		});
		await connection.db
			.update(dastTargetConfigs)
			.set({
				origin: "http://localhost:3000",
				normalizedOrigin: "http://localhost:3000",
			})
			.where(eq(dastTargetConfigs.id, targetConfigId));

		await expect(
			repository.decryptForOriginUse({
				id: created.id,
				projectId,
				targetOrigin: "http://localhost:3000",
				identityRole: "cookie-user",
			}),
		).rejects.toThrow("cookie_domain_out_of_scope");
		await expect(
			repository.decryptForUse({
				id: created.id,
				projectId,
				targetConfigId,
				identityRole: "cookie-user",
			}),
		).rejects.toThrow("cookie_domain_out_of_scope");
	});

	it("rejects revoked and expired credentials before use", async () => {
		const expired = await repository.create({
			projectId,
			targetConfigId,
			identityRole: "expired",
			label: "Expired",
			secret: { kind: "bearer_token", token: "expired-canary" },
			loginFlow: [],
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			createdByUserId: userId,
		});
		await connection.db
			.update(dastAuthContexts)
			.set({ expiresAt: new Date(Date.now() - 1_000) })
			.where(eq(dastAuthContexts.id, expired.id));
		await expect(
			repository.decryptForUse({
				id: expired.id,
				projectId,
				targetConfigId,
				identityRole: "expired",
			}),
		).rejects.toThrow("expired");
		await repository.revoke(expired.id, projectId, userId);
		await expect(
			repository.decryptForUse({
				id: expired.id,
				projectId,
				targetConfigId,
				identityRole: "expired",
			}),
		).rejects.toThrow("revoked");
	});
});
