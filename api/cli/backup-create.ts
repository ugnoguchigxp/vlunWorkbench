import { readAppEnv } from "../app/env";
import { createDatabaseBackup } from "../operations/database-backup";

const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
if (!outputPath) {
	throw new Error("Usage: bun run backup:create -- --output <backup.sqlite>");
}

const result = await createDatabaseBackup(readAppEnv().databaseUrl, outputPath);
process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
