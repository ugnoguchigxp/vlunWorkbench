import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";
import {
	canonicalDatabasePath,
	databaseIdFromUrl,
	defaultWriterSocketPath,
	writerLockPath,
} from "../database-url";
import { decodeWriterValue, encodeWriterValue } from "./codec";
import { createWriterOwnedConnection } from "./internal/connection";
import {
	WRITER_PROTOCOL_VERSION,
	type WriterErrorCode,
	type WriterHealth,
	type WriterRequest,
	type WriterResponse,
	type WriterStatement,
	writerRequestSchema,
} from "./protocol";
import { WriterQueue } from "./queue";

const DEFAULT_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const HARD_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MIGRATIONS_TABLE = "vuln_workbench_schema_migrations";

type WriterLockMetadata = {
	pid: number;
	databaseId: string;
	writerInstanceId: string;
	createdAt: string;
};

export type SqliteWriterServer = {
	readonly databaseId: string;
	readonly writerInstanceId: string;
	readonly socketPath: string;
	stop(): Promise<void>;
};

function sqliteErrorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object") return undefined;
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

function safeErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message.split("\n", 1)[0];
	return "SQLite Writer request failed.";
}

function assertMutationSql(sql: string): void {
	if (new RegExp(`\\b${MIGRATIONS_TABLE}\\b`, "i").test(sql)) {
		throw new Error(
			"Normal SQLite Writer clients cannot mutate migration history.",
		);
	}
	if (/^(insert|update|delete|replace)\b/i.test(sql.trimStart())) {
		return;
	}
	throw new Error(
		"Normal SQLite Writer clients may execute mutation statements only.",
	);
}

function executeStatement(
	sqlite: Database,
	statement: WriterStatement,
): unknown {
	assertMutationSql(statement.sql);
	const prepared = sqlite.query(statement.sql);
	const params = statement.params.map((param) => decodeWriterValue(param));
	if (statement.method === "run") {
		return (prepared.run as (...values: unknown[]) => unknown)(...params);
	}
	const rows = (prepared.values as (...values: unknown[]) => unknown[][])(
		...params,
	);
	if (statement.method === "get") return rows[0];
	return rows;
}

function executeAtomicBatch(
	sqlite: Database,
	statements: WriterStatement[],
): unknown[] {
	sqlite.run("BEGIN IMMEDIATE");
	try {
		for (const statement of statements) assertMutationSql(statement.sql);
		const results = statements.map((statement) =>
			executeStatement(sqlite, statement),
		);
		sqlite.run("COMMIT");
		return results;
	} catch (error) {
		sqlite.run("ROLLBACK");
		throw error;
	}
}

function ensureMigrationsTable(sqlite: Database): void {
	sqlite.run(`
		CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
			filename text PRIMARY KEY,
			checksum text,
			applied_at integer NOT NULL DEFAULT (unixepoch() * 1000)
		)
	`);
	const columns = sqlite
		.query<{ name: string }, []>(`PRAGMA table_info(${MIGRATIONS_TABLE})`)
		.all();
	if (!columns.some((column) => column.name === "checksum")) {
		sqlite.run(`ALTER TABLE ${MIGRATIONS_TABLE} ADD COLUMN checksum text`);
	}
}

function applyMigration(
	sqlite: Database,
	filename: string,
	sqlText: string,
): { applied: boolean } {
	const checksum = createHash("sha256").update(sqlText).digest("hex");
	const existing = sqlite
		.query<{ filename: string; checksum: string | null }, [string]>(
			`SELECT filename, checksum FROM ${MIGRATIONS_TABLE} WHERE filename = ?1`,
		)
		.get(filename);
	if (existing) {
		if (existing.checksum && existing.checksum !== checksum) {
			throw new Error(`SQLite migration drift detected: ${filename}`);
		}
		if (!existing.checksum) {
			sqlite
				.query(
					`UPDATE ${MIGRATIONS_TABLE} SET checksum = ?1 WHERE filename = ?2`,
				)
				.run(checksum, filename);
		}
		return { applied: false };
	}
	sqlite.run("BEGIN IMMEDIATE");
	try {
		sqlite.exec(sqlText);
		sqlite
			.query(
				`INSERT INTO ${MIGRATIONS_TABLE} (filename, checksum) VALUES (?1, ?2)`,
			)
			.run(filename, checksum);
		sqlite.run("COMMIT");
		return { applied: true };
	} catch (error) {
		sqlite.run("ROLLBACK");
		throw error;
	}
}

function acquireWriterLock(
	databaseUrl: string,
	metadata: WriterLockMetadata,
): string {
	const lockPath = writerLockPath(databaseUrl);
	mkdirSync(path.dirname(lockPath), { recursive: true });
	try {
		mkdirSync(lockPath, { mode: 0o700 });
	} catch (error) {
		let detail = "";
		try {
			detail = readFileSync(path.join(lockPath, "owner.json"), "utf8");
		} catch {
			// The owner may still be writing its metadata.
		}
		throw new Error(
			`SQLite Writer lock already exists for ${canonicalDatabasePath(databaseUrl)}${detail ? `: ${detail}` : ""}`,
			{ cause: error },
		);
	}
	try {
		writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify(metadata), {
			mode: 0o600,
		});
	} catch (error) {
		rmSync(lockPath, { recursive: true, force: true });
		throw error;
	}
	return lockPath;
}

export function startSqliteWriterServer(options: {
	databaseUrl: string;
	socketPath?: string;
	maxRequestBytes?: number;
}): SqliteWriterServer {
	const databaseId = databaseIdFromUrl(options.databaseUrl);
	const writerInstanceId = randomUUID();
	const socketPath =
		options.socketPath ?? defaultWriterSocketPath(options.databaseUrl);
	const maxRequestBytes = options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
	if (
		!Number.isSafeInteger(maxRequestBytes) ||
		maxRequestBytes <= 0 ||
		maxRequestBytes > HARD_MAX_REQUEST_BYTES
	) {
		throw new Error(
			`SQLite Writer maxRequestBytes must be between 1 and ${HARD_MAX_REQUEST_BYTES}.`,
		);
	}
	const lockPath = acquireWriterLock(options.databaseUrl, {
		pid: process.pid,
		databaseId,
		writerInstanceId,
		createdAt: new Date().toISOString(),
	});

	const queue = new WriterQueue();
	let sequence = 0;
	let draining = false;
	let migrationsInitialized = false;
	let stopPromise: Promise<void> | undefined;
	let connection: ReturnType<typeof createWriterOwnedConnection>;
	try {
		const socketDirectory = path.dirname(socketPath);
		mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
		rmSync(socketPath, { force: true });
		connection = createWriterOwnedConnection(options.databaseUrl);
	} catch (error) {
		rmSync(socketPath, { force: true });
		rmSync(lockPath, { recursive: true, force: true });
		throw error;
	}

	const respond = (
		requestId: string,
		ok: boolean,
		options: {
			result?: unknown;
			code?: WriterErrorCode;
			message?: string;
			sqliteCode?: string;
		} = {},
	): WriterResponse => ({
		protocolVersion: WRITER_PROTOCOL_VERSION,
		requestId,
		writerInstanceId,
		sequence,
		ok,
		...(options.result !== undefined
			? { result: encodeWriterValue(options.result) }
			: {}),
		...(options.code
			? {
					error: {
						code: options.code,
						message: options.message ?? "SQLite Writer request failed.",
						...(options.sqliteCode ? { sqliteCode: options.sqliteCode } : {}),
					},
				}
			: {}),
	});

	let server: ReturnType<typeof Bun.serve> | undefined;
	const previousUmask = process.umask(0o077);
	try {
		server = Bun.serve({
			unix: socketPath,
			maxRequestBodySize: HARD_MAX_REQUEST_BYTES,
			async fetch(request) {
				let requestSequence = sequence;
				const headerRequestId =
					request.headers.get("x-sqlite-writer-request-id") ?? "unknown";
				if (request.method !== "POST") {
					return new Response("Method Not Allowed", { status: 405 });
				}
				const contentLength = Number(
					request.headers.get("content-length") ?? "0",
				);
				if (contentLength > maxRequestBytes) {
					return Response.json(
						respond(headerRequestId, false, {
							code: "WRITER_REQUEST_TOO_LARGE",
							message: "SQLite Writer request exceeds the configured limit.",
						}),
						{ status: 413 },
					);
				}

				let parsed: ReturnType<typeof writerRequestSchema.safeParse>;
				try {
					const bodyText = await request.text();
					if (Buffer.byteLength(bodyText, "utf8") > maxRequestBytes) {
						return Response.json(
							respond(headerRequestId, false, {
								code: "WRITER_REQUEST_TOO_LARGE",
								message: "SQLite Writer request exceeds the configured limit.",
							}),
							{ status: 413 },
						);
					}
					parsed = writerRequestSchema.safeParse(JSON.parse(bodyText));
				} catch {
					parsed = { success: false } as typeof parsed;
				}
				if (!parsed.success) {
					return Response.json(
						respond(headerRequestId, false, {
							code: "WRITER_INVALID_REQUEST",
							message: "Invalid SQLite Writer request.",
						}),
						{ status: 400 },
					);
				}
				const writerRequest = parsed.data as WriterRequest;
				if (
					headerRequestId !== "unknown" &&
					headerRequestId !== writerRequest.requestId
				) {
					return Response.json(
						respond(headerRequestId, false, {
							code: "WRITER_INVALID_REQUEST",
							message: "SQLite Writer request identity mismatch.",
						}),
						{ status: 400 },
					);
				}
				if (writerRequest.databaseId !== databaseId) {
					return Response.json(
						respond(writerRequest.requestId, false, {
							code: "WRITER_DATABASE_MISMATCH",
							message: "SQLite Writer database identity mismatch.",
						}),
						{ status: 409 },
					);
				}
				if (writerRequest.kind === "health") {
					const health: WriterHealth = {
						status: draining ? "draining" : "ready",
						writerInstanceId,
						databaseId,
						protocolVersion: WRITER_PROTOCOL_VERSION,
						pid: process.pid,
						queueDepth: queue.depth,
						lastSequence: sequence,
					};
					return Response.json(
						respond(writerRequest.requestId, true, { result: health }),
					);
				}

				try {
					const response = await queue.enqueue(() => {
						requestSequence = ++sequence;
						if (writerRequest.kind === "execute") {
							return respond(writerRequest.requestId, true, {
								result: executeStatement(
									connection.sqlite,
									writerRequest.statement as WriterStatement,
								),
							});
						}
						if (writerRequest.kind === "atomic_batch") {
							return respond(writerRequest.requestId, true, {
								result: executeAtomicBatch(
									connection.sqlite,
									writerRequest.statements as WriterStatement[],
								),
							});
						}
						if (!migrationsInitialized) {
							ensureMigrationsTable(connection.sqlite);
							migrationsInitialized = true;
						}
						return respond(writerRequest.requestId, true, {
							result: applyMigration(
								connection.sqlite,
								writerRequest.filename,
								writerRequest.sql,
							),
						});
					});
					return Response.json(response);
				} catch (error) {
					return Response.json(
						{
							...respond(writerRequest.requestId, false, {
								code:
									writerRequest.kind === "atomic_batch" ||
									writerRequest.kind === "admin_migrate"
										? "WRITER_TRANSACTION_FAILED"
										: "WRITER_STATEMENT_FAILED",
								message: safeErrorMessage(error),
								sqliteCode: sqliteErrorCode(error),
							}),
							sequence: requestSequence,
						},
						{ status: 500 },
					);
				}
			},
		});
		chmodSync(socketPath, 0o600);
	} catch (error) {
		server?.stop(true);
		connection.close();
		rmSync(socketPath, { force: true });
		rmSync(lockPath, { recursive: true, force: true });
		throw error;
	} finally {
		process.umask(previousUmask);
	}

	return {
		databaseId,
		writerInstanceId,
		socketPath,
		async stop() {
			if (!stopPromise) {
				stopPromise = (async () => {
					draining = true;
					queue.stopAccepting();
					await queue.whenIdle();
					server.stop(true);
					try {
						connection.close();
					} finally {
						rmSync(socketPath, { force: true });
						rmSync(lockPath, { recursive: true, force: true });
					}
				})();
			}
			await stopPromise;
		},
	};
}

export function readWriterLockMetadata(
	databaseUrl: string,
): WriterLockMetadata | null {
	try {
		return JSON.parse(
			readFileSync(
				path.join(writerLockPath(databaseUrl), "owner.json"),
				"utf8",
			),
		) as WriterLockMetadata;
	} catch {
		return null;
	}
}
