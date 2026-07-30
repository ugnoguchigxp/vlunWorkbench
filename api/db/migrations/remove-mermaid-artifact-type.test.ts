import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";

describe("0016_remove_mermaid_artifact_type", () => {
	it("converts legacy rows to code and preserves object metadata", async () => {
		const db = new Database(":memory:");
		try {
			db.exec(`
				CREATE TABLE artifacts (
					id text PRIMARY KEY,
					type text NOT NULL,
					metadata text,
					updated_at integer NOT NULL
				);
			`);
			const insert = db.prepare(
				"INSERT INTO artifacts (id, type, metadata, updated_at) VALUES (?, ?, ?, 0)",
			);
			insert.run("object", "mermaid", '{"owner":"test"}');
			insert.run("null", " MERMAID ", null);
			insert.run("other", "code", '{"owner":"unchanged"}');

			const migration = await readFile(
				path.resolve(
					process.cwd(),
					"drizzle/0016_remove_mermaid_artifact_type.sql",
				),
				"utf8",
			);
			db.exec(migration);

			const rows = db
				.query<
					{ id: string; type: string; metadata: string },
					[]
				>("SELECT id, type, metadata FROM artifacts ORDER BY id")
				.all();
			expect(rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) })))
				.toEqual([
					{
						id: "null",
						type: "code",
						metadata: { legacyArtifactType: "mermaid" },
					},
					{
						id: "object",
						type: "code",
						metadata: {
							owner: "test",
							legacyArtifactType: "mermaid",
						},
					},
					{
						id: "other",
						type: "code",
						metadata: { owner: "unchanged" },
					},
				]);
		} finally {
			db.close();
		}
	});
});
