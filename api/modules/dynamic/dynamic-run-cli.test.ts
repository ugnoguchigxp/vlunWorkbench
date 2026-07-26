import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import { migrateTestDatabase } from "../../db/testing/migrate";
import { DynamicRepository } from "./dynamic-repository";

describe("Dynamic Run CLI", () => {
	let connection: DbConnection;
	let repo: DynamicRepository;
	let userId: string;
	let projectId: string;
	let dbFile: string;

	beforeEach(async () => {
		dbFile = path.join(os.tmpdir(), `dynamic-cli-test-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.sqlite`);
		await migrateTestDatabase(`file:${dbFile}`);
		connection = createDbConnection(`file:${dbFile}`);

		repo = new DynamicRepository(connection.db);

		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "cli-test@example.com",
				passwordHash: "hash",
				displayName: "CLI User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		const [proj] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "CLI Project",
				repoPath: "/valid/path",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = proj.id;

		// Seed config
		await repo.createConfig({
			projectId,
			profileId: "test-profile",
			dynamicKind: "test",
			displayName: "Test Profile",
			commandJson: ["bun", "test"],
			createdByUserId: userId,
		});
	});

	afterEach(async () => {
		await closeTestDbConnection(connection);
		await fs.unlink(dbFile).catch(() => {});
		vi.restoreAllMocks();
	});

	it("should parse argv and perform a dry run using dynamic-run CLI process", async () => {
		const proc = Bun.spawnSync([
			"bun",
			"run",
			"api/cli/dynamic-run.ts",
			"--project-id",
			projectId,
			"--profile",
			"test-profile",
			"--runner",
			"docker",
			"--dry-run",
			"true",
		], {
			env: {
				...process.env,
				DATABASE_URL: `file:${dbFile}`,
			}
		});

		const stdout = proc.stdout.toString().trim();
		const result = JSON.parse(stdout);

		expect(proc.success).toBe(true);
		expect(result.dryRun).toBe(true);
		expect(result.profileId).toBe("test-profile");
		expect(result.command).toEqual(["bun", "test"]);
	});

	it("should print a descriptive validation failure for unsafe binary", async () => {
		// Create an unsafe config
		await repo.createConfig({
			projectId,
			profileId: "unsafe-profile",
			dynamicKind: "test",
			displayName: "Unsafe Profile",
			commandJson: ["bash", "-c", "rm -rf /"],
			createdByUserId: userId,
		});

		const proc = Bun.spawnSync([
			"bun",
			"run",
			"api/cli/dynamic-run.ts",
			"--project-id",
			projectId,
			"--profile",
			"unsafe-profile",
			"--runner",
			"docker",
			"--dry-run",
			"true",
		], {
			env: {
				...process.env,
				DATABASE_URL: `file:${dbFile}`,
			}
		});

		const stdout = proc.stdout.toString().trim();
		const result = JSON.parse(stdout);

		expect(proc.success).toBe(false);
		expect(result.ok).toBe(false);
		expect(result.message).toContain("explicitly blacklisted");
	});
});
