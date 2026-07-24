import { verifyDatabaseBackup } from "../operations/database-backup";

const inputIndex = process.argv.indexOf("--input");
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
if (!inputPath) {
	throw new Error("Usage: bun run backup:verify -- --input <backup.sqlite>");
}

process.stdout.write(
	`${JSON.stringify(await verifyDatabaseBackup(inputPath))}\n`,
);
