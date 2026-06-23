import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";

type MigrationRecord = {
	filename: string;
	applied_at: number;
};

const MIGRATIONS_TABLE = "vuln_workbench_schema_migrations";

async function listSqlMigrations(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

function ensureMigrationsTable(sqlite: Database): void {
	sqlite.run(`
		CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
			filename text PRIMARY KEY,
			applied_at integer NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
}

function appliedMigrations(sqlite: Database): Set<string> {
	const rows = sqlite
		.query<MigrationRecord, []>(
			`SELECT filename, applied_at FROM ${MIGRATIONS_TABLE}`,
		)
		.all();
	return new Set(rows.map((row) => row.filename));
}

async function applyMigrationFile(
	sqlite: Database,
	migrationsDir: string,
	filename: string,
): Promise<void> {
	const fullPath = path.resolve(migrationsDir, filename);
	const sqlText = await readFile(fullPath, "utf8");
	sqlite.run("BEGIN");
	try {
		sqlite.exec(sqlText);
		sqlite
			.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES (?1)`)
			.run(filename);
		sqlite.run("COMMIT");
	} catch (error) {
		sqlite.run("ROLLBACK");
		throw error;
	}
}

async function main() {
	const env = readAppEnv();
	const connection = createDbConnection(env.databaseUrl);
	const migrationsDir = path.resolve(process.cwd(), "drizzle");

	try {
		ensureMigrationsTable(connection.sqlite);
		const allMigrations = await listSqlMigrations(migrationsDir);
		const applied = appliedMigrations(connection.sqlite);
		const pending = allMigrations.filter((filename) => !applied.has(filename));

		for (const filename of pending) {
			await applyMigrationFile(connection.sqlite, migrationsDir, filename);
			console.log(`applied: ${filename}`);
		}

		console.log(
			JSON.stringify(
				{
					ok: true,
					total: allMigrations.length,
					applied: pending.length,
					skipped: allMigrations.length - pending.length,
				},
				null,
				2,
			),
		);
	} finally {
		connection.sqlite.close(false);
	}
}

await main();
