import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDatabaseParentDirectory } from "./path";

const tempRoots: string[] = [];

function makeTempRoot(): string {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hono-standard-db-"));
	tempRoots.push(tempRoot);
	return tempRoot;
}

afterEach(() => {
	for (const tempRoot of tempRoots.splice(0)) {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

describe("database path initialization", () => {
	it("creates parent directories for SQLite database files", () => {
		const databasePath = path.join(makeTempRoot(), "nested", "sqlite.db");

		ensureDatabaseParentDirectory(databasePath);

		expect(fs.existsSync(path.dirname(databasePath))).toBe(true);
	});

	it("rejects URL-style database connection strings", () => {
		expect(() =>
			ensureDatabaseParentDirectory(
				"postgres://postgres:postgres@127.0.0.1:5432/app",
			),
		).toThrow(/SQLite database file path/);
	});

	it("does not create directories for memory or current-directory databases", () => {
		expect(() => ensureDatabaseParentDirectory(":memory:")).not.toThrow();
		expect(() => ensureDatabaseParentDirectory("sqlite.db")).not.toThrow();
	});
});
