import { readAppEnv } from "../app/env";
import { runMigrations } from "../db/migrate";

async function main() {
	const env = readAppEnv();
	const result = await runMigrations(env);
	console.log(JSON.stringify(result, null, 2));
}

await main();
