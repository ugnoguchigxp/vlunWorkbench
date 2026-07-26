import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
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
