import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("createSqliteDbRuntime", () => {
	const temporaryDirectories: string[] = [];

	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("uses WAL and exposes a physically read-only reader", async () => {
		const directory = mkdtempSync(path.join(tmpdir(), "hono-standard-sqlite-"));
		temporaryDirectories.push(directory);
		const databaseUrl = path.join(directory, "app.sqlite");
		const script = `
			import { sql } from "drizzle-orm";
			import { createSqliteDbRuntime } from "./api/db/sqlite.ts";
			const runtime = createSqliteDbRuntime({ databaseUrl: process.env.TEST_DATABASE_URL });
			try {
				const mode = await runtime.client.write.execute((db) => db.get(sql\`PRAGMA journal_mode\`));
				if (mode?.[0] !== "wal") throw new Error("WAL was not enabled");
				await runtime.client.write.execute((db) => db.run(sql\`CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)\`));
				await runtime.client.write.execute((db) => db.run(sql\`INSERT INTO messages (body) VALUES ('hello')\`));
				const row = runtime.client.read.get(sql\`SELECT body FROM messages LIMIT 1\`);
				if (row?.[0] !== "hello") throw new Error("reader did not observe committed write");
				let readonlyError = false;
				try {
					await runtime.client.read.run(sql\`INSERT INTO messages (body) VALUES ('not allowed')\`);
				} catch {
					readonlyError = true;
				}
				if (!readonlyError) throw new Error("reader accepted a write");
			} finally {
				await runtime.close();
			}
		`;
		const result = spawnSync("bun", ["-e", script], {
			cwd: process.cwd(),
			encoding: "utf8",
			env: {
				...process.env,
				TEST_DATABASE_URL: databaseUrl,
			},
		});

		expect(result.status, result.stderr).toBe(0);
	});
});
