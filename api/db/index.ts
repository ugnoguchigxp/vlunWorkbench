import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";

import * as schema from "./schema";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

declare global {
	var __vulnWorkbenchCustomSqliteConfigured__: boolean | undefined;
}

export type DbConnection = {
	sqlite: Database;
	db: AppDatabase;
	/** このパッケージが接続を所有しているか（close責任があるか） */
	ownsConnection: boolean;
};

function sqlitePathFromDatabaseUrl(databaseUrl: string): string {
	if (databaseUrl === ":memory:") return databaseUrl;
	if (databaseUrl.startsWith("file:")) {
		return databaseUrl.slice("file:".length);
	}
	if (databaseUrl.startsWith("sqlite://")) {
		return databaseUrl.slice("sqlite://".length);
	}
	return databaseUrl;
}

function isSqliteAlreadyLoadedError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes("SQLite already loaded")
	);
}

function configureSqliteExtensionLoading(): void {
	if (globalThis.__vulnWorkbenchCustomSqliteConfigured__) return;
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
			if (!isSqliteAlreadyLoadedError(error)) {
				throw error;
			}
		}
		globalThis.__vulnWorkbenchCustomSqliteConfigured__ = true;
		return;
	}
	globalThis.__vulnWorkbenchCustomSqliteConfigured__ = true;
}

export function createDbConnection(databaseUrl: string): DbConnection {
	configureSqliteExtensionLoading();
	const sqlitePath = sqlitePathFromDatabaseUrl(databaseUrl);
	if (sqlitePath !== ":memory:") {
		mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
	}
	const sqlite = new Database(sqlitePath, { create: true, strict: true });
	sqlite.run("PRAGMA foreign_keys = ON");
	sqlite.run("PRAGMA journal_mode = WAL");
	sqliteVec.load(sqlite);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db, ownsConnection: true };
}

export function wrapExternalDatabase(sqlite: Database): DbConnection {
	sqlite.run("PRAGMA foreign_keys = ON");
	sqliteVec.load(sqlite);
	const db = drizzle(sqlite, { schema });
	return { sqlite, db, ownsConnection: false };
}

export async function connectDb(sqlite: Database) {
	sqlite.query("select 1").get();
}

export { schema };
