import { users } from "../../schema";
import { SqliteWriterClient } from "../client";

const [databaseUrl, socketPath, indexText] = process.argv.slice(2);
if (!databaseUrl || !socketPath || indexText === undefined) {
	throw new Error("databaseUrl, socketPath, and index are required.");
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
console.log(
	JSON.stringify({
		writerInstanceId: health.writerInstanceId,
		pid: health.pid,
	}),
);
await client.close();
