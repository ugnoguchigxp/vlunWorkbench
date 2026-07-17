import { parseArgs } from "node:util";
import { readAppEnv } from "../app/env";
import { startSqliteWriterServer } from "../db/writer/server";

const parsed = parseArgs({
	args: process.argv.slice(2),
	options: {
		"database-url": { type: "string" },
		socket: { type: "string" },
	},
	strict: true,
});

const env = readAppEnv();
const server = startSqliteWriterServer({
	databaseUrl: parsed.values["database-url"] ?? env.databaseUrl,
	socketPath: parsed.values.socket,
});

console.log(
	JSON.stringify({
		ok: true,
		status: "ready",
		databaseId: server.databaseId,
		writerInstanceId: server.writerInstanceId,
		socketPath: server.socketPath,
	}),
);

let stopping = false;
async function stop(signal: string): Promise<void> {
	if (stopping) return;
	stopping = true;
	await server.stop();
	console.error(`SQLite Writer stopped (${signal}).`);
	process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
