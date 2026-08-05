import fs from "node:fs";
import path from "node:path";

const URL_WITH_AUTHORITY_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isDatabaseConnectionUrl(databasePath: string): boolean {
	return URL_WITH_AUTHORITY_PATTERN.test(databasePath);
}

export function assertDatabaseFilePath(databasePath: string): void {
	if (isDatabaseConnectionUrl(databasePath)) {
		throw new Error("DATABASE_URL must be a SQLite database file path.");
	}
}

export function ensureDatabaseParentDirectory(databasePath: string): void {
	assertDatabaseFilePath(databasePath);
	if (databasePath === ":memory:") return;

	const parentDirectory = path.dirname(databasePath);
	if (parentDirectory === ".") return;

	fs.mkdirSync(parentDirectory, { recursive: true });
}
