import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrateTestDatabase } from "../db/testing/migrate";
import {
	createDatabaseBackup,
	verifyDatabaseBackup,
} from "./database-backup";

let root: string | undefined;

afterEach(async () => {
	if (root) await rm(root, { recursive: true, force: true });
	root = undefined;
});

describe("database backup", () => {
	it("creates a Writer-consistent backup and verifies integrity and migrations", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "vuln-workbench-backup-"));
		const databasePath = path.join(root, "live.sqlite");
		const backupPath = path.join(root, "backups", "snapshot.sqlite");
		await migrateTestDatabase(`file:${databasePath}`);

		const created = await createDatabaseBackup(
			`file:${databasePath}`,
			backupPath,
		);
		expect(created.outputPath).toBe(backupPath);

		const verified = await verifyDatabaseBackup(backupPath);
		expect(verified.integrity).toBe("ok");
		expect(verified.appliedMigrations).toBeGreaterThan(0);
		expect(verified.checksummedMigrations).toBe(verified.appliedMigrations);
		expect(verified.legacyUncheckedMigrations).toBe(0);
	});

	it("verifies legacy backups whose migration table predates checksums", async () => {
		root = await mkdtemp(path.join(os.tmpdir(), "vuln-workbench-backup-"));
		const backupPath = path.join(root, "legacy.sqlite");
		const sqlite = new Database(backupPath, { create: true, strict: true });
		try {
			sqlite.run(
				"CREATE TABLE vuln_workbench_schema_migrations (filename text PRIMARY KEY, applied_at integer NOT NULL)",
			);
			sqlite
				.query(
					"INSERT INTO vuln_workbench_schema_migrations (filename, applied_at) VALUES (?1, ?2)",
				)
				.run("0001_initial.sql", Date.now());
			sqlite.run("CREATE TABLE users (id text PRIMARY KEY)");
		} finally {
			sqlite.close(false);
		}

		const verified = await verifyDatabaseBackup(backupPath);
		expect(verified.integrity).toBe("ok");
		expect(verified.appliedMigrations).toBe(1);
		expect(verified.checksummedMigrations).toBe(0);
		expect(verified.legacyUncheckedMigrations).toBe(1);
	});
});
