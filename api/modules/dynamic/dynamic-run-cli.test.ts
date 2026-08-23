import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../../cli/dynamic-run";
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
	let previousDatabaseUrl: string | undefined;
	let previousDynamicImage: string | undefined;

	async function runCli(args: string[]) {
		const outputs: Record<string, unknown>[] = [];
		const exitCode = await main(args, (result) => outputs.push(result));
		expect(outputs).toHaveLength(1);
		return { exitCode, result: outputs[0] };
	}

	beforeEach(async () => {
		dbFile = path.join(os.tmpdir(), `dynamic-cli-test-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.sqlite`);
		previousDatabaseUrl = process.env.DATABASE_URL;
		previousDynamicImage = process.env.VULN_WORKBENCH_DYNAMIC_IMAGE;
		process.env.DATABASE_URL = `file:${dbFile}`;
		process.env.VULN_WORKBENCH_DYNAMIC_IMAGE = `dynamic@sha256:${"a".repeat(64)}`;
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
		if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = previousDatabaseUrl;
		if (previousDynamicImage === undefined)
			delete process.env.VULN_WORKBENCH_DYNAMIC_IMAGE;
		else process.env.VULN_WORKBENCH_DYNAMIC_IMAGE = previousDynamicImage;
	});

	it("should parse argv and perform a dry run using dynamic-run CLI process", async () => {
		const proc = await runCli([
			"--project-id",
			projectId,
			"--profile",
			"test-profile",
			"--runner",
			"docker",
			"--dry-run",
			"true",
		]);

		expect(proc.exitCode).toBe(0);
		const result = proc.result as { dryRun: boolean; profileId: string; command: string[] };
		expect(result.dryRun).toBe(true);
		expect(result.profileId).toBe("test-profile");
		expect(result.command).toEqual(["bun", "test"]);
	});

	it("rejects execution without explicit project-code consent", async () => {
		const proc = await runCli([
			"--project-id",
			projectId,
			"--profile",
			"test-profile",
			"--runner",
			"docker",
		]);

		expect(proc.exitCode).toBe(1);
		expect((proc.result as { message: string }).message).toContain(
			"--consent-project-code-execution true",
		);
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

		const proc = await runCli([
			"--project-id",
			projectId,
			"--profile",
			"unsafe-profile",
			"--runner",
			"docker",
			"--dry-run",
			"true",
		]);

		expect(proc.exitCode).toBe(1);
		const result = proc.result as { ok: boolean; message: string };
		expect(result.ok).toBe(false);
		expect(result.message).toContain("explicitly blacklisted");
	});
});
