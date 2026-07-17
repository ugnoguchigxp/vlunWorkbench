import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getSqliteWriterClient } from "../writer/client";

export async function migrateTestDatabase(databaseUrl: string): Promise<void> {
	const writer = getSqliteWriterClient(databaseUrl);
	try {
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const filenames = (await readdir(migrationsDir))
			.filter((filename) => filename.endsWith(".sql"))
			.sort((left, right) => left.localeCompare(right));
		for (const filename of filenames) {
			await writer.applyMigration(
				filename,
				await readFile(path.join(migrationsDir, filename), "utf8"),
			);
		}
	} finally {
		await writer.close({ shutdownIfOwned: true });
	}
}
