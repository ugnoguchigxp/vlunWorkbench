import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { SqliteWriterClient } from "../db/writer/client";

const parsed = parseArgs({
	args: process.argv.slice(2),
	options: {
		"database-url": { type: "string" },
		socket: { type: "string" },
	},
	strict: true,
});

const env = readAppEnv();
const client = new SqliteWriterClient(
	parsed.values["database-url"] ?? env.databaseUrl,
	{
		socketPath: parsed.values.socket,
		autoStart: false,
	},
);

try {
	console.log(
		JSON.stringify({ ok: true, ...(await client.health()) }, null, 2),
	);
} catch (error) {
	console.error(
		JSON.stringify(
			{
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			},
			null,
			2,
		),
	);
	process.exitCode = 1;
}
