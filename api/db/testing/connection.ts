import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";
import { configureSqliteExtensionLoading, type DbConnection } from "..";
import { canonicalDatabasePath } from "../database-url";
import * as schema from "../schema";

export function createWritableTestDbConnection(
	databaseUrl: string,
): DbConnection {
	const isTestProcess =
		process.env.NODE_ENV === "test" ||
		process.argv.some((argument) => /\.test\.tsx?$/.test(argument));
	if (!isTestProcess) {
		throw new Error(
			"Writable test database connections require NODE_ENV=test.",
		);
	}
	configureSqliteExtensionLoading();
	const sqlitePath = canonicalDatabasePath(databaseUrl);
	if (sqlitePath !== ":memory:") {
		mkdirSync(path.dirname(sqlitePath), { recursive: true });
	}
	const sqlite = new Database(sqlitePath, { create: true, strict: true });
	sqlite.run("PRAGMA foreign_keys = ON");
	sqliteVec.load(sqlite);
	return {
		sqlite,
		db: drizzle(sqlite, { schema }),
		ownsConnection: true,
	};
}

export async function closeTestDbConnection(
	connection: DbConnection,
): Promise<void> {
	try {
		await connection.writerClient?.close({ shutdownIfOwned: true });
	} finally {
		if (connection.ownsConnection) connection.sqlite.close(false);
	}
}

export type LocalRuntimeDatabaseFixture = {
	connection: DbConnection;
	sqliteVersion: string;
	insertMutation(value: string): void;
	readFindingPage(): number;
	readCurrentIntelligenceGeneration(): number | null;
	close(): void;
};

export function createLocalRuntimeDatabaseFixture(
	options: { populateReadFixtures?: boolean } = {},
): LocalRuntimeDatabaseFixture {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Local runtime fixtures are unavailable in production.");
	}
	const sqlite = new Database(":memory:", { create: true, strict: true });
	sqlite.exec("PRAGMA foreign_keys = ON");
	sqlite.exec(
		"CREATE TABLE vuln_workbench_schema_migrations (filename TEXT PRIMARY KEY)",
	);
	sqlite.exec(
		"CREATE TABLE benchmark_mutations (id INTEGER PRIMARY KEY, value TEXT NOT NULL)",
	);
	sqlite.exec(
		"CREATE TABLE findings (id INTEGER PRIMARY KEY, scan_id TEXT NOT NULL, created_at INTEGER NOT NULL, title TEXT NOT NULL)",
	);
	sqlite.exec(
		"CREATE INDEX findings_page ON findings(scan_id, created_at, id)",
	);
	sqlite.exec(
		"CREATE TABLE intelligence_generations (id INTEGER PRIMARY KEY, project_id TEXT NOT NULL, created_at INTEGER NOT NULL, snapshot_json TEXT NOT NULL)",
	);
	const insertMutation = sqlite.prepare(
		"INSERT INTO benchmark_mutations (value) VALUES (?)",
	);
	const insertFinding = sqlite.prepare(
		"INSERT INTO findings (scan_id, created_at, title) VALUES ('s-1', ?, ?)",
	);
	const insertGeneration = sqlite.prepare(
		"INSERT INTO intelligence_generations (project_id, created_at, snapshot_json) VALUES ('p-1', ?, ?)",
	);
	if (options.populateReadFixtures) {
		sqlite.exec("BEGIN IMMEDIATE");
		try {
			for (let index = 0; index < 10_000; index += 1) {
				insertFinding.run(index, `finding-${index}`);
			}
			for (let index = 0; index < 100; index += 1) {
				insertGeneration.run(
					index,
					JSON.stringify({ generation: index, modules: ["api", "web"] }),
				);
			}
			sqlite.exec("COMMIT");
		} catch (error) {
			sqlite.exec("ROLLBACK");
			throw error;
		}
	}
	const connection = {
		sqlite,
		db: drizzle(sqlite, { schema }),
		ownsConnection: true,
	};
	return {
		connection,
		sqliteVersion:
			sqlite
				.query<{ version: string }, []>("SELECT sqlite_version() AS version")
				.get()?.version ?? "unknown",
		insertMutation: (value) => {
			insertMutation.run(value);
		},
		readFindingPage: () =>
			sqlite
				.query(
					"SELECT id, title FROM findings WHERE scan_id = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT 101",
				)
				.all("s-1", 4_999, 4_999, 5_000).length,
		readCurrentIntelligenceGeneration: () => {
			const row = sqlite
				.query<{ snapshot_json: string }, [string]>(
					"SELECT snapshot_json FROM intelligence_generations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
				)
				.get("p-1");
			return row
				? (JSON.parse(row.snapshot_json) as { generation: number }).generation
				: null;
		},
		close: () => sqlite.close(),
	};
}

type Migration = { filename: string; sql: string };

function createMigrationFixture(filePath: string): Database {
	const database = new Database(filePath, { create: true, strict: true });
	database.exec("PRAGMA foreign_keys = ON");
	database.exec(
		"CREATE TABLE vuln_workbench_schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
	);
	return database;
}

function applyFixtureMigration(database: Database, migration: Migration): void {
	database.exec("BEGIN IMMEDIATE");
	try {
		database.exec(migration.sql);
		database
			.prepare(
				"INSERT INTO vuln_workbench_schema_migrations (filename, applied_at) VALUES (?, ?)",
			)
			.run(migration.filename, Date.now());
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

function verifyMigrationFixture(database: Database, expected: number): void {
	const integrity = database
		.query<{ integrity_check: string }, []>("PRAGMA integrity_check")
		.get();
	const applied = database
		.query<{ count: number }, []>(
			"SELECT count(*) AS count FROM vuln_workbench_schema_migrations",
		)
		.get()?.count;
	const paginationIndex = database
		.query<{ name: string }, [string]>(
			"SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
		)
		.get("findings_scan_run_created_id_idx");
	if (
		integrity?.integrity_check !== "ok" ||
		applied !== expected ||
		!paginationIndex
	) {
		throw new Error("Migration fixture verification failed.");
	}
}

export async function verifyMigrationReadinessFixtures(): Promise<{
	migrationCount: number;
	latestMigration: string;
}> {
	if (process.env.NODE_ENV === "production") {
		throw new Error("Migration fixtures are unavailable in production.");
	}
	const directory = path.resolve("drizzle");
	const filenames = (await readdir(directory))
		.filter((filename) => filename.endsWith(".sql"))
		.sort((left, right) => left.localeCompare(right));
	const migrations = await Promise.all(
		filenames.map(async (filename) => ({
			filename,
			sql: await readFile(path.join(directory, filename), "utf8"),
		})),
	);
	const latest = migrations.at(-1);
	if (migrations.length < 2 || !latest) {
		throw new Error("Migration fixture is incomplete.");
	}
	const root = await mkdtemp(
		path.join(os.tmpdir(), "vuln-workbench-migration-"),
	);
	try {
		const fresh = createMigrationFixture(path.join(root, "fresh.sqlite"));
		for (const migration of migrations) applyFixtureMigration(fresh, migration);
		verifyMigrationFixture(fresh, migrations.length);
		fresh.close();

		const upgrade = createMigrationFixture(path.join(root, "upgrade.sqlite"));
		for (const migration of migrations.slice(0, -1)) {
			applyFixtureMigration(upgrade, migration);
		}
		applyFixtureMigration(upgrade, latest);
		verifyMigrationFixture(upgrade, migrations.length);
		upgrade.close();
		return {
			migrationCount: migrations.length,
			latestMigration: latest.filename,
		};
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
