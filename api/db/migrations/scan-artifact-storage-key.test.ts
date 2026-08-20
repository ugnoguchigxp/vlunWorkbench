import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("0033_scan_artifact_storage_key", () => {
	it("preserves legacy duplicate paths and only enforces uniqueness for new storage keys", async () => {
		const db = new Database(":memory:");
		try {
			db.exec(`
				CREATE TABLE scan_artifacts (
					id text PRIMARY KEY,
					path text NOT NULL
				);
				INSERT INTO scan_artifacts (id, path) VALUES
					('legacy-1', 'scan-1/raw/result.json'),
					('legacy-2', 'scan-1/raw/result.json');
			`);
			const migration = await readFile(
				path.resolve(
					process.cwd(),
					"drizzle/0033_scan_artifact_storage_key.sql",
				),
				"utf8",
			);
			db.exec(migration);

			expect(
				db
					.query<{ id: string; storageKey: string | null }, []>(
						"SELECT id, storage_key AS storageKey FROM scan_artifacts ORDER BY id",
					)
					.all(),
			).toEqual([
				{ id: "legacy-1", storageKey: null },
				{ id: "legacy-2", storageKey: null },
			]);
			db.exec(
				"INSERT INTO scan_artifacts (id, path, storage_key) VALUES ('new-1', 'legacy/path', 'scan-1/owners/tool-run/tool-1/raw/result.json')",
			);
			expect(() =>
				db.exec(
					"INSERT INTO scan_artifacts (id, path, storage_key) VALUES ('new-2', 'other/path', 'scan-1/owners/tool-run/tool-1/raw/result.json')",
				),
			).toThrow();
		} finally {
			db.close();
		}
	});
});
