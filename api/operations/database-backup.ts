import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { getSqliteWriterClient } from "../db/writer/client";

const MIGRATIONS_TABLE = "vuln_workbench_schema_migrations";

export async function createDatabaseBackup(
	databaseUrl: string,
	outputPath: string,
): Promise<{ outputPath: string }> {
	const absoluteOutput = path.resolve(outputPath);
	const writer = getSqliteWriterClient(databaseUrl);
	try {
		return await writer.createBackup(absoluteOutput);
	} finally {
		await writer.close({ shutdownIfOwned: true });
	}
}

export type BackupVerification = {
	ok: true;
	inputPath: string;
	integrity: "ok";
	appliedMigrations: number;
	checksummedMigrations: number;
	legacyUncheckedMigrations: number;
	representativeRecordCounts: Record<string, number>;
};

export async function verifyDatabaseBackup(
	inputPath: string,
	migrationsDirectory = path.resolve(process.cwd(), "drizzle"),
): Promise<BackupVerification> {
	const absoluteInput = path.resolve(inputPath);
	const metadata = await stat(absoluteInput);
	if (!metadata.isFile() || metadata.nlink !== 1) {
		throw new Error("Backup input must be a regular, non-hard-linked file.");
	}

	const sqlite = new Database(absoluteInput, { readonly: true, strict: true });
	try {
		sqlite.run("PRAGMA query_only = ON");
		const integrityRows = sqlite
			.query<{ integrity_check: string }, []>("PRAGMA integrity_check")
			.all();
		if (
			integrityRows.length !== 1 ||
			integrityRows[0]?.integrity_check !== "ok"
		) {
			throw new Error("SQLite integrity check failed.");
		}

		const table = sqlite
			.query<{ name: string }, [string]>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
			)
			.get(MIGRATIONS_TABLE);
		if (!table) throw new Error("Backup has no migration history table.");

		const migrationColumns = sqlite
			.query<{ name: string }, []>(`PRAGMA table_info(${MIGRATIONS_TABLE})`)
			.all();
		const hasChecksumColumn = migrationColumns.some(
			(column) => column.name === "checksum",
		);
		const applied = sqlite
			.query<{ filename: string; checksum: string | null }, []>(
				hasChecksumColumn
					? `SELECT filename, checksum FROM ${MIGRATIONS_TABLE} ORDER BY filename`
					: `SELECT filename, NULL AS checksum FROM ${MIGRATIONS_TABLE} ORDER BY filename`,
			)
			.all();
		const migrationFiles = (
			await readdir(migrationsDirectory, { withFileTypes: true })
		)
			.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
			.map((entry) => entry.name);
		const knownMigrations = new Set(migrationFiles);
		for (const migration of applied) {
			if (!knownMigrations.has(migration.filename)) {
				throw new Error(`Backup has unknown migration: ${migration.filename}`);
			}
			if (migration.checksum) {
				const content = await readFile(
					path.join(migrationsDirectory, migration.filename),
				);
				const checksum = createHash("sha256").update(content).digest("hex");
				if (checksum !== migration.checksum) {
					throw new Error(
						`Backup migration checksum mismatch: ${migration.filename}`,
					);
				}
			}
		}

		const representativeRecordCounts: Record<string, number> = {};
		for (const tableName of ["users", "projects", "scan_runs", "findings"]) {
			const exists = sqlite
				.query<{ name: string }, [string]>(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?1",
				)
				.get(tableName);
			if (!exists) continue;
			const row = sqlite
				.query<{ count: number }, []>(
					`SELECT count(*) AS count FROM ${tableName}`,
				)
				.get();
			representativeRecordCounts[tableName] = row?.count ?? 0;
		}

		return {
			ok: true,
			inputPath: absoluteInput,
			integrity: "ok",
			appliedMigrations: applied.length,
			checksummedMigrations: applied.filter((migration) => migration.checksum)
				.length,
			legacyUncheckedMigrations: applied.filter(
				(migration) => !migration.checksum,
			).length,
			representativeRecordCounts,
		};
	} finally {
		sqlite.close(false);
	}
}
