import { Database } from "bun:sqlite";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { AppEnv } from "../app/env";
import { createSingleWriterClient, type DatabaseClient } from "./client";
import { ensureDatabaseParentDirectory } from "./path";
import * as schema from "./schema";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;
export type AppDatabaseClient = DatabaseClient<AppDatabase>;

export type DbRuntime = {
	client: AppDatabaseClient;
	close: () => Promise<void>;
};

function configureWriter(client: Database): void {
	client.run("PRAGMA journal_mode = WAL;");
	client.run("PRAGMA busy_timeout = 5000;");
	client.run("PRAGMA foreign_keys = ON;");
	// read-only connections cannot initialize WAL sidecar files themselves.
	client.query("SELECT count(*) FROM sqlite_schema").get();
}

function configureReader(client: Database): void {
	client.run("PRAGMA busy_timeout = 5000;");
	client.run("PRAGMA foreign_keys = ON;");
}

function isInMemoryDatabase(databasePath: string): boolean {
	return (
		databasePath === ":memory:" || databasePath.startsWith("file::memory:")
	);
}

function createWriterConnection(databasePath: string): {
	client: Database;
	db: AppDatabase;
} {
	ensureDatabaseParentDirectory(databasePath);
	const client = new Database(databasePath, { create: true });
	configureWriter(client);
	const db = drizzle(client, { schema });
	return { client, db };
}

function createReaderConnection(databasePath: string): {
	client: Database;
	db: AppDatabase;
} {
	const client = new Database(databasePath, { readonly: true });
	configureReader(client);
	const db = drizzle(client, { schema });
	return { client, db };
}

export function createSqliteDbRuntime(env: AppEnv): DbRuntime {
	const writerConnection = createWriterConnection(env.databaseUrl);
	const readerConnection = isInMemoryDatabase(env.databaseUrl)
		? writerConnection
		: createReaderConnection(env.databaseUrl);
	const writer = createSingleWriterClient(writerConnection.db);
	let closed = false;

	return {
		client: {
			read: readerConnection.db,
			write: writer,
		},
		close: async () => {
			if (closed) return;
			closed = true;
			await writer.close();
			if (readerConnection !== writerConnection) {
				readerConnection.client.close();
			}
			writerConnection.client.close();
		},
	};
}

/**
 * 接続を確立する
 */
export async function connectDb(client: Database) {
	client.query("SELECT 1").get();
}
