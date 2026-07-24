import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as sqliteVec from "sqlite-vec";

import * as schema from "./schema";
import { canonicalDatabasePath } from "./database-url";
import {
	getSqliteWriterClient,
	type SqliteWriterClient,
} from "./writer/client";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;
const WRITER_CLIENT = Symbol.for("vulnWorkbench.sqliteWriterClient");

declare global {
	var __vulnWorkbenchCustomSqliteConfigured__: boolean | undefined;
}

export type DbConnection = {
	sqlite: Database;
	db: AppDatabase;
	writerClient?: SqliteWriterClient;
	/** このパッケージが接続を所有しているか（close責任があるか） */
	ownsConnection: boolean;
};

export type DbConnectionOptions = {
	/** Test/process harnesses may stop a Writer they started when the read handle closes. */
	shutdownWriterOnClose?: boolean;
};

function isSqliteAlreadyLoadedError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes("SQLite already loaded")
	);
}

export function configureSqliteExtensionLoading(): void {
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

export function createDbConnection(
	databaseUrl: string,
	options: DbConnectionOptions = {},
): DbConnection {
	configureSqliteExtensionLoading();
	const sqlitePath = canonicalDatabasePath(databaseUrl);
	if (sqlitePath === ":memory:") {
		const sqlite = new Database(sqlitePath, { create: true, strict: true });
		sqlite.run("PRAGMA foreign_keys = ON");
		sqliteVec.load(sqlite);
		const db = drizzle(sqlite, { schema });
		return { sqlite, db, ownsConnection: true };
	}

	if (!existsSync(sqlitePath)) {
		throw new Error(
			`SQLite database does not exist: ${sqlitePath}. Run bun run db:migrate first.`,
		);
	}
	const sqlite = new Database(sqlitePath, { readonly: true, strict: true });
	sqlite.run("PRAGMA foreign_keys = ON");
	sqlite.run("PRAGMA query_only = ON");
	sqliteVec.load(sqlite);
	const readDb = drizzle(sqlite, { schema });
	const writerClient = getSqliteWriterClient(databaseUrl);
	const writeDb = writerClient.db;
	const shutdownWriterOnClose =
		options.shutdownWriterOnClose ?? process.env.NODE_ENV === "test";
	if (shutdownWriterOnClose) {
		const closeReadConnection = sqlite.close.bind(sqlite);
		sqlite.close = ((throwOnError?: boolean) => {
			writerClient.shutdownIfOwned();
			return closeReadConnection(throwOnError);
		}) as Database["close"];
	}
	const mutationProperties = new Set<PropertyKey>([
		"insert",
		"update",
		"delete",
		"run",
	]);
	const db = new Proxy(readDb, {
		get(target, property) {
			if (property === WRITER_CLIENT) return writerClient;
			if (property === "transaction") {
				return () => {
					throw new Error(
						"Cross-process transaction callbacks are not supported. Use an atomic Writer batch.",
					);
				};
			}
			const source = mutationProperties.has(property) ? writeDb : target;
			const value = Reflect.get(source, property, source);
			return typeof value === "function" ? value.bind(source) : value;
		},
	}) as AppDatabase;
	return { sqlite, db, writerClient, ownsConnection: true };
}

export function writerClientForDatabase(
	db: AppDatabase,
): SqliteWriterClient | undefined {
	return Reflect.get(db, WRITER_CLIENT) as SqliteWriterClient | undefined;
}

type DbTransactionCallback = Parameters<AppDatabase["transaction"]>[0];

export function runInProcessDbTransaction(
	db: AppDatabase,
	callback: DbTransactionCallback,
): ReturnType<AppDatabase["transaction"]> {
	if (writerClientForDatabase(db)) {
		throw new Error(
			"File-backed databases must use an atomic Writer batch instead of an in-process transaction.",
		);
	}
	return db.transaction(callback);
}

export async function connectDb(sqlite: Database) {
	sqlite.query("select 1").get();
}

export { schema };
