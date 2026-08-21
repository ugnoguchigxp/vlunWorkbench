import { writeFile } from "node:fs/promises";
import { users } from "../../schema";
import { SqliteWriterClient } from "../client";

const [databaseUrl, socketPath, indexText, outputPath] = process.argv.slice(2);
if (!databaseUrl || !socketPath || indexText === undefined || !outputPath) {
	throw new Error(
		"databaseUrl, socketPath, index, and outputPath are required.",
	);
}
const index = Number(indexText);
const client = new SqliteWriterClient(databaseUrl, { socketPath });
const now = new Date();
await client.db.insert(users).values({
	id: `concurrent-${index}`,
	email: `concurrent-${index}@example.com`,
	passwordHash: "hash",
	displayName: `Concurrent ${index}`,
	role: "member",
	isActive: true,
	createdAt: now,
	updatedAt: now,
});
const health = await client.health();
await writeFile(
	outputPath,
	`${JSON.stringify({
		writerInstanceId: health.writerInstanceId,
		pid: health.pid,
	})}\n`,
	{ encoding: "utf8", flag: "wx" },
);
await client.close();
