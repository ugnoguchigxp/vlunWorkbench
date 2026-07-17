import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readAppEnv } from "../app/env";
import { getSqliteWriterClient } from "../db/writer/client";

async function listSqlMigrations(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
}

async function readMigrationFile(
	migrationsDir: string,
	filename: string,
): Promise<string> {
	const fullPath = path.resolve(migrationsDir, filename);
	return await readFile(fullPath, "utf8");
}

async function main() {
	const env = readAppEnv();
	const writer = getSqliteWriterClient(env.databaseUrl);
	const migrationsDir = path.resolve(process.cwd(), "drizzle");

	try {
		const allMigrations = await listSqlMigrations(migrationsDir);
		let applied = 0;
		for (const filename of allMigrations) {
			const result = await writer.applyMigration(
				filename,
				await readMigrationFile(migrationsDir, filename),
			);
			if (result.applied) {
				applied += 1;
				console.log(`applied: ${filename}`);
			}
		}

		console.log(
			JSON.stringify(
				{
					ok: true,
					total: allMigrations.length,
					applied,
					skipped: allMigrations.length - applied,
				},
				null,
				2,
			),
		);
	} finally {
		await writer.close({ shutdownIfOwned: true });
	}
}

await main();
