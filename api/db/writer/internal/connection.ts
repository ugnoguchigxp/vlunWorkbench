import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";
import * as schema from "../../schema";
import { canonicalDatabasePath } from "../../database-url";

declare global {
	var __vulnWorkbenchWriterSqliteConfigured__: boolean | undefined;
}

function isSqliteAlreadyLoadedError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes("SQLite already loaded")
	);
}

function configureSqliteExtensionLoading(): void {
	if (globalThis.__vulnWorkbenchWriterSqliteConfigured__) return;
	const candidates = [
		process.env.SQLITE_DYLIB_PATH,
		"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
		"/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib",
		"/usr/local/opt/sqlite/lib/libsqlite3.dylib",
		"/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
	].filter((candidate): candidate is string => Boolean(candidate));

	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			Database.setCustomSQLite(candidate);
		} catch (error) {
			if (!isSqliteAlreadyLoadedError(error)) throw error;
		}
		break;
	}
	globalThis.__vulnWorkbenchWriterSqliteConfigured__ = true;
}

export function createWriterOwnedConnection(databaseUrl: string) {
	configureSqliteExtensionLoading();
	const sqlitePath = canonicalDatabasePath(databaseUrl);
	if (sqlitePath === ":memory:") {
		throw new Error("The external SQLite Writer does not support :memory:.");
	}
	mkdirSync(path.dirname(sqlitePath), { recursive: true });
	const sqlite = new Database(sqlitePath, { create: true, strict: true });
	if (statSync(sqlitePath).nlink > 1) {
		sqlite.close(false);
		throw new Error(
			`Hard-linked SQLite database files are not supported: ${sqlitePath}`,
		);
	}
	sqlite.run("PRAGMA foreign_keys = ON");
	sqlite.run("PRAGMA journal_mode = WAL");
	sqlite.run("PRAGMA busy_timeout = 5000");
	sqliteVec.load(sqlite);
	return {
		sqlite,
		db: drizzle(sqlite, { schema }),
		close: () => sqlite.close(false),
	};
}
