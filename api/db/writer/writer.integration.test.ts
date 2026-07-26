import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { link, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection } from "..";
import { writerLockPath } from "../database-url";
import { users } from "../schema";
import { closeTestDbConnection } from "../testing/connection";
import { migrateTestDatabase } from "../testing/migrate";
import { SqliteWriterClient, SqliteWriterClientError } from "./client";
import { encodeWriterValue } from "./codec";
import {
	type SqliteWriterServer,
	startSqliteWriterServer,
} from "./server";

const roots: string[] = [];
const servers: SqliteWriterServer[] = [];
const writerPids = new Set<number>();

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await Bun.sleep(20);
	}
	throw new Error(`SQLite Writer ${pid} did not stop within ${timeoutMs}ms.`);
}

afterEach(async () => {
	for (const pid of writerPids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// The writer may already have stopped.
		}
	}
	await Promise.all([...writerPids].map((pid) => waitForProcessExit(pid)));
	writerPids.clear();
	await Promise.all(servers.splice(0).map((server) => server.stop()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function setup() {
	const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-test-"));
	roots.push(root);
	const dbPath = path.join(root, "test.sqlite");
	const databaseUrl = `file:${dbPath}`;
	const socketPath = path.join(root, "writer.sock");
	const server = startSqliteWriterServer({ databaseUrl, socketPath });
	servers.push(server);
	const client = new SqliteWriterClient(databaseUrl, {
		socketPath,
		autoStart: false,
	});

	const migrationFiles = (await readdir(path.resolve("drizzle")))
		.filter((filename) => filename.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of migrationFiles) {
		await client.applyMigration(
			filename,
			await readFile(path.resolve("drizzle", filename), "utf8"),
		);
	}
	return { root, dbPath, databaseUrl, socketPath, server, client };
}

function countUsers(dbPath: string): number {
	const readOnly = new Database(dbPath, { readonly: true, strict: true });
	try {
		return (
			readOnly
				.query<{ count: number }, []>("SELECT count(*) AS count FROM users")
				.get()?.count ?? 0
		);
	} finally {
		readOnly.close();
	}
}

describe("SQLite Writer", () => {
	it("executes Drizzle mutations in the writer and exposes them to read-only connections", async () => {
		const { dbPath, client, server } = await setup();
		const now = new Date();
		const [created] = await client.db
			.insert(users)
			.values({
				email: "writer@example.com",
				passwordHash: "hash",
				displayName: "Writer",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		expect(created.email).toBe("writer@example.com");
		expect((await client.health()).writerInstanceId).toBe(
			server.writerInstanceId,
		);

		const readOnly = new Database(dbPath, { readonly: true, strict: true });
		try {
			const row = readOnly
				.query<{ email: string }, []>("SELECT email FROM users LIMIT 1")
				.get();
			expect(row?.email).toBe("writer@example.com");
			expect(() =>
				readOnly.query("DELETE FROM users").run(),
			).toThrow();
		} finally {
			readOnly.close();
		}
	});

	it("keeps facade reads local and requires the Writer client for facade mutations", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-facade-"));
		roots.push(root);
		const dbPath = path.join(root, "facade.sqlite");
		const databaseUrl = `file:${dbPath}`;
		await migrateTestDatabase(databaseUrl);

		const connection = createDbConnection(databaseUrl);
		try {
			expect(await connection.db.$count(users)).toBe(0);
			expect(existsSync(writerLockPath(databaseUrl))).toBe(false);
			expect(() => connection.sqlite.query("DELETE FROM users").run()).toThrow();

			const now = new Date();
			await connection.db.insert(users).values({
				email: "facade@example.com",
				passwordHash: "hash",
				displayName: "Facade",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
			const health = await connection.writerClient?.health();
			if (health) writerPids.add(health.pid);
			expect(health?.databaseId).toBe(connection.writerClient?.databaseId);
			expect(existsSync(writerLockPath(databaseUrl))).toBe(true);
			expect(await connection.db.$count(users)).toBe(1);
		} finally {
			await closeTestDbConnection(connection);
		}
	}, 15_000);

	it("keeps an autostarted Writer alive when a production-style facade closes", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-lifetime-"));
		roots.push(root);
		const databaseUrl = `file:${path.join(root, "lifetime.sqlite")}`;
		await migrateTestDatabase(databaseUrl);

		const connection = createDbConnection(databaseUrl, {
			shutdownWriterOnClose: false,
		});
		const now = new Date();
		await connection.db.insert(users).values({
			email: "lifetime@example.com",
			passwordHash: "hash",
			displayName: "Lifetime",
			role: "member",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		const originalHealth = await connection.writerClient?.health();
		expect(originalHealth).toBeDefined();
		if (!originalHealth) throw new Error("Writer health is unavailable.");
		writerPids.add(originalHealth.pid);
		connection.sqlite.close();

		const observer = new SqliteWriterClient(databaseUrl, { autoStart: false });
		const observedHealth = await observer.health();
		expect(observedHealth.pid).toBe(originalHealth?.pid);
		expect(observedHealth.writerInstanceId).toBe(
			originalHealth?.writerInstanceId,
		);
	}, 15_000);

	it("rejects reads and schema changes on the normal Writer RPC", async () => {
		const { dbPath, client } = await setup();
		await expect(
			client.execute({ sql: "SELECT 1", params: [], method: "get" }),
		).rejects.toThrow("mutation statements only");
		await expect(
			client.execute({
				sql: "CREATE TABLE forbidden (id text)",
				params: [],
				method: "run",
			}),
		).rejects.toThrow("mutation statements only");
		await expect(
			client.execute({
				sql: "DELETE FROM vuln_workbench_schema_migrations",
				params: [],
				method: "run",
			}),
		).rejects.toThrow("cannot mutate migration history");
		await client.execute({
			sql: "INSERT\nINTO users (id, email, password_hash, display_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			params: [
				"newline-mutation",
				"newline@example.com",
				"hash",
				"Newline",
				"member",
				1,
				Date.now(),
				Date.now(),
			].map(encodeWriterValue),
			method: "run",
		});
		expect(countUsers(dbPath)).toBe(1);
	});

	it("invalidates a dead connection so a later request can reconnect", async () => {
		const { dbPath, databaseUrl, socketPath, server, client } = await setup();
		await client.health();
		servers.splice(servers.indexOf(server), 1);
		await server.stop();

		const now = new Date();
		const insertUser = async (email: string) =>
			await client.db.insert(users).values({
				email,
				passwordHash: "hash",
				displayName: "Reconnect",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			});
		await expect(insertUser("failed@example.com")).rejects.toThrow();

		const replacement = startSqliteWriterServer({ databaseUrl, socketPath });
		servers.push(replacement);
		await insertUser("reconnected@example.com");
		expect(countUsers(dbPath)).toBe(1);
		expect((await client.health()).writerInstanceId).toBe(
			replacement.writerInstanceId,
		);
	});

	it("bounds health requests and reports timeout outcomes as unknown", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-timeout-"));
		roots.push(root);
		const socketPath = path.join(root, "hanging.sock");
		const hangingServer = Bun.serve({
			unix: socketPath,
			async fetch() {
				return await new Promise<Response>(() => {});
			},
		});
		try {
			const client = new SqliteWriterClient(
				`file:${path.join(root, "unused.sqlite")}`,
				{
					socketPath,
					autoStart: false,
					healthTimeoutMs: 50,
				},
			);
			const error = await client.health().catch((caught) => caught);
			expect(error).toBeInstanceOf(SqliteWriterClientError);
			expect((error as SqliteWriterClientError).code).toBe(
				"WRITER_RESULT_UNKNOWN",
			);
			expect((error as Error).message).toContain("timed out");
		} finally {
			hangingServer.stop(true);
		}
	});

	it("fails immediately on an incompatible live Writer protocol", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-version-"));
		roots.push(root);
		const databaseUrl = `file:${path.join(root, "version.sqlite")}`;
		const socketPath = path.join(root, "old-writer.sock");
		const oldWriter = Bun.serve({
			unix: socketPath,
			async fetch(request) {
				const payload = (await request.json()) as { requestId: string };
				return Response.json({
					protocolVersion: 1,
					requestId: payload.requestId,
					writerInstanceId: "old-writer",
					sequence: 0,
					ok: true,
					result: null,
				});
			},
		});
		try {
			const client = new SqliteWriterClient(databaseUrl, { socketPath });
			const startedAt = Date.now();
			const error = await client
				.execute({
					sql: "DELETE FROM users",
					params: [],
					method: "run",
				})
				.catch((caught) => caught);
			expect(error).toBeInstanceOf(SqliteWriterClientError);
			expect((error as SqliteWriterClientError).code).toBe(
				"WRITER_PROTOCOL_MISMATCH",
			);
			expect(Date.now() - startedAt).toBeLessThan(1_000);
			expect(existsSync(writerLockPath(databaseUrl))).toBe(false);
		} finally {
			oldWriter.stop(true);
		}
	});

	it("preserves the server error code for an oversized request", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-size-"));
		roots.push(root);
		const databaseUrl = `file:${path.join(root, "size.sqlite")}`;
		const socketPath = path.join(root, "size.sock");
		const server = startSqliteWriterServer({
			databaseUrl,
			socketPath,
			maxRequestBytes: 512,
		});
		servers.push(server);
		const client = new SqliteWriterClient(databaseUrl, {
			socketPath,
			autoStart: false,
		});
		const error = await client
			.execute({
				sql: "DELETE FROM users WHERE id = ?",
				params: [encodeWriterValue("x".repeat(2_000))],
				method: "run",
			})
			.catch((caught) => caught);
		expect(error).toBeInstanceOf(SqliteWriterClientError);
		expect((error as SqliteWriterClientError).writerCode).toBe(
			"WRITER_REQUEST_TOO_LARGE",
		);
	});

	it("serializes concurrent clients through one writer instance", async () => {
		const { dbPath, databaseUrl, socketPath, server, client } = await setup();
		const clients = [
			client,
			...Array.from(
				{ length: 9 },
				() =>
					new SqliteWriterClient(databaseUrl, {
						socketPath,
						autoStart: false,
					}),
			),
		];
		const now = new Date();
		await Promise.all(
			clients.map((entry, index) =>
				entry.db.insert(users).values({
					id: randomUUID(),
					email: `writer-${index}@example.com`,
					passwordHash: "hash",
					displayName: `Writer ${index}`,
					role: "member",
					isActive: true,
					createdAt: now,
					updatedAt: now,
				}),
			),
		);

		const health = await Promise.all(clients.map((entry) => entry.health()));
		expect(new Set(health.map((entry) => entry.writerInstanceId))).toEqual(
			new Set([server.writerInstanceId]),
		);
		expect(countUsers(dbPath)).toBe(10);
	});

	it("rolls back an atomic batch and rejects a second writer", async () => {
		const { dbPath, databaseUrl, socketPath, client } = await setup();
		await expect(
			client.atomicBatch([
				{
					sql: "INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
					params: [
						"batch-1",
						"duplicate@example.com",
						"hash",
						"Batch",
						"member",
						1,
						Date.now(),
						Date.now(),
					].map(encodeWriterValue),
					method: "run",
				},
				{
					sql: "INSERT INTO users (id, email, password_hash, display_name, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
					params: [
						"batch-2",
						"duplicate@example.com",
						"hash",
						"Batch",
						"member",
						1,
						Date.now(),
						Date.now(),
					].map(encodeWriterValue),
					method: "run",
				},
			]),
		).rejects.toThrow();
		expect(countUsers(dbPath)).toBe(0);
		expect(() =>
			startSqliteWriterServer({ databaseUrl, socketPath }),
		).toThrow("lock already exists");
	});

	it("detects migration drift and rolls back a partially failing migration", async () => {
		const { dbPath, client } = await setup();
		await expect(
			client.applyMigration(
				"0001_initial.sql",
				"CREATE TABLE changed_migration (id text);",
			),
		).rejects.toThrow("migration drift detected");

		await expect(
			client.applyMigration(
				"broken-migration.sql",
				[
					"CREATE TABLE writer_partial_migration (id text);",
					"INSERT INTO writer_partial_migration (id) VALUES ('created');",
					"INSERT INTO table_that_does_not_exist (id) VALUES ('fail');",
				].join("\n"),
			),
		).rejects.toThrow();

		const readOnly = new Database(dbPath, { readonly: true, strict: true });
		try {
			const table = readOnly
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'writer_partial_migration'",
				)
				.get();
			const history = readOnly
				.query<{ count: number }, []>(
					"SELECT count(*) AS count FROM vuln_workbench_schema_migrations WHERE filename = 'broken-migration.sql'",
				)
				.get();
			expect(table?.count).toBe(0);
			expect(history?.count).toBe(0);
		} finally {
			readOnly.close();
		}
	});

	it("elects one writer when independent processes autostart concurrently", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-race-"));
		roots.push(root);
		const databaseUrl = `file:${path.join(root, "race.sqlite")}`;
		const socketPath = path.join(root, "race.sock");
		await migrateTestDatabase(databaseUrl);

		const processes = Array.from({ length: 10 }, (_, index) =>
			Bun.spawn(
				[
					process.execPath,
					"api/db/writer/fixtures/concurrent-client.ts",
					databaseUrl,
					socketPath,
					String(index),
				],
				{
					cwd: process.cwd(),
					stdout: "pipe",
					stderr: "pipe",
				},
			),
		);
		const outputs = await Promise.all(
			processes.map(async (proc) => {
				const [exitCode, stdout, stderr] = await Promise.all([
					proc.exited,
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);
				expect(stderr).toBe("");
				expect(exitCode).toBe(0);
				return JSON.parse(stdout) as {
					writerInstanceId: string;
					pid: number;
				};
			}),
		);
		for (const output of outputs) writerPids.add(output.pid);
		expect(new Set(outputs.map((output) => output.writerInstanceId)).size).toBe(
			1,
		);
		expect(writerPids.size).toBe(1);

		const readOnly = new Database(path.join(root, "race.sqlite"), {
			readonly: true,
			strict: true,
		});
		try {
			const row = readOnly
				.query<{ count: number }, []>("SELECT count(*) AS count FROM users")
				.get();
			expect(row?.count).toBe(10);
		} finally {
			readOnly.close();
		}
		const writerPid = outputs[0]?.pid;
		if (!writerPid) throw new Error("Autostarted Writer PID is unavailable.");
		process.kill(writerPid, "SIGTERM");
		await waitForProcessExit(writerPid);
		writerPids.delete(writerPid);
	}, 15_000);

	it("rejects hard-linked database aliases that cannot share WAL sidecars", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "vuln-writer-hardlink-"));
		roots.push(root);
		const originalPath = path.join(root, "original.sqlite");
		const aliasPath = path.join(root, "alias.sqlite");
		await writeFile(originalPath, "");
		await link(originalPath, aliasPath);
		expect(() =>
			startSqliteWriterServer({
				databaseUrl: `file:${aliasPath}`,
				socketPath: path.join(root, "hardlink.sock"),
			}),
		).toThrow("Hard-linked SQLite database files are not supported");
	});
});
