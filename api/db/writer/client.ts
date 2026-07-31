import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import {
	databaseIdFromUrl,
	defaultWriterSocketPath,
	writerLockPath,
} from "../database-url";
import * as schema from "../schema";
import { decodeWriterValue, encodeWriterValue } from "./codec";
import {
	WRITER_PROTOCOL_VERSION,
	type WriterHealth,
	type WriterMethod,
	type WriterRequest,
	type WriterResponse,
	type WriterStatement,
	writerHealthSchema,
	writerResponseSchema,
} from "./protocol";
import {
	delay,
	type FetchUnixInit,
	processExists,
	SqliteWriterClientError,
} from "./client-support";

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const WRITER_SHUTDOWN_TIMEOUT_MS = 5_000;
const ownedWriterClients = new Set<SqliteWriterClient>();
export { SqliteWriterClientError } from "./client-support";
export class SqliteWriterClient {
	readonly databaseId: string;
	readonly socketPath: string;
	readonly db: ReturnType<typeof drizzle<typeof schema>>;
	private startPromise?: Promise<WriterHealth>;
	private lastHealth?: WriterHealth;
	private spawnedPid?: number;
	private spawnedExit?: Promise<number>;

	constructor(
		readonly databaseUrl: string,
		private readonly options: {
			socketPath?: string;
			autoStart?: boolean;
			connectTimeoutMs?: number;
			healthTimeoutMs?: number;
			requestTimeoutMs?: number;
		} = {},
	) {
		this.databaseId = databaseIdFromUrl(databaseUrl);
		this.socketPath =
			options.socketPath ??
			process.env.SQLITE_WRITER_SOCKET ??
			defaultWriterSocketPath(databaseUrl);

		const callback = async (
			sql: string,
			params: unknown[],
			method: WriterMethod,
		) => {
			const result = await this.execute({
				sql,
				params: params.map(encodeWriterValue),
				method,
			});
			return { rows: result as never };
		};
		const batchCallback = async (
			batch: Array<{
				sql: string;
				params: unknown[];
				method: WriterMethod;
			}>,
		) => {
			const results = await this.atomicBatch(
				batch.map((statement) => ({
					...statement,
					params: statement.params.map(encodeWriterValue),
				})),
			);
			return results.map((rows) => ({ rows: rows as never }));
		};
		this.db = drizzle(callback, batchCallback, { schema });
	}
	get writerInstanceId(): string | undefined {
		return this.lastHealth?.writerInstanceId;
	}

	async health(): Promise<WriterHealth> {
		const response = await this.sendRaw(
			{
				protocolVersion: WRITER_PROTOCOL_VERSION,
				requestId: randomUUID(),
				databaseId: this.databaseId,
				kind: "health",
			},
			this.options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
		);
		const parsedHealth = writerHealthSchema.safeParse(
			decodeWriterValue(response.result ?? null),
		);
		if (
			!parsedHealth.success ||
			parsedHealth.data.databaseId !== this.databaseId
		) {
			throw new SqliteWriterClientError(
				"SQLite Writer handshake mismatch.",
				"WRITER_PROTOCOL_MISMATCH",
			);
		}
		const health = parsedHealth.data;
		this.lastHealth = health;
		return health;
	}

	async execute(statement: WriterStatement): Promise<unknown> {
		return await this.withConnectionState(async () => {
			await this.ensureStarted();
			const response = await this.sendRaw({
				protocolVersion: WRITER_PROTOCOL_VERSION,
				requestId: randomUUID(),
				databaseId: this.databaseId,
				kind: "execute",
				statement,
			});
			return decodeWriterValue(response.result ?? null);
		});
	}

	async atomicBatch(statements: WriterStatement[]): Promise<unknown[]> {
		return await this.withConnectionState(async () => {
			await this.ensureStarted();
			const response = await this.sendRaw({
				protocolVersion: WRITER_PROTOCOL_VERSION,
				requestId: randomUUID(),
				databaseId: this.databaseId,
				kind: "atomic_batch",
				statements,
			});
			return decodeWriterValue(response.result ?? []) as unknown[];
		});
	}

	async atomicDrizzleBatch(
		queries: Array<{ toSQL(): { sql: string; params: unknown[] } }>,
	): Promise<unknown[]> {
		return await this.atomicBatch(
			queries.map((query) => {
				const compiled = query.toSQL();
				return {
					sql: compiled.sql,
					params: compiled.params.map(encodeWriterValue),
					method: "run" as const,
				};
			}),
		);
	}

	async applyMigration(
		filename: string,
		sql: string,
	): Promise<{ applied: boolean }> {
		return await this.withConnectionState(async () => {
			await this.ensureStarted();
			const response = await this.sendRaw({
				protocolVersion: WRITER_PROTOCOL_VERSION,
				requestId: randomUUID(),
				databaseId: this.databaseId,
				kind: "admin_migrate",
				filename,
				sql,
			});
			return decodeWriterValue(response.result ?? null) as { applied: boolean };
		});
	}

	async createBackup(outputPath: string): Promise<{ outputPath: string }> {
		return await this.withConnectionState(async () => {
			await this.ensureStarted();
			const response = await this.sendRaw({
				protocolVersion: WRITER_PROTOCOL_VERSION,
				requestId: randomUUID(),
				databaseId: this.databaseId,
				kind: "admin_backup",
				outputPath,
			});
			return decodeWriterValue(response.result ?? null) as {
				outputPath: string;
			};
		});
	}

	private async withConnectionState<T>(
		operation: () => Promise<T>,
	): Promise<T> {
		try {
			return await operation();
		} catch (error) {
			if (
				error instanceof SqliteWriterClientError &&
				(error.code === "WRITER_UNAVAILABLE" ||
					error.code === "WRITER_PROTOCOL_MISMATCH" ||
					error.code === "WRITER_DATABASE_MISMATCH" ||
					error.code === "WRITER_RESULT_UNKNOWN")
			) {
				this.startPromise = undefined;
				this.lastHealth = undefined;
			}
			throw error;
		}
	}

	async close(options: { shutdownIfOwned?: boolean } = {}): Promise<void> {
		const ownedPid = options.shutdownIfOwned
			? this.shutdownIfOwned()
			: undefined;
		if (ownedPid) {
			const lockPath = writerLockPath(this.databaseUrl);
			const deadline = Date.now() + WRITER_SHUTDOWN_TIMEOUT_MS;
			while (
				(processExists(ownedPid) || existsSync(lockPath)) &&
				Date.now() < deadline
			) {
				await delay(20);
			}
			if (!processExists(ownedPid) && existsSync(lockPath)) {
				await this.recoverStaleWriterArtifacts();
			}
			if (processExists(ownedPid) || existsSync(lockPath)) {
				throw new SqliteWriterClientError(
					`SQLite Writer ${ownedPid} did not stop within ${WRITER_SHUTDOWN_TIMEOUT_MS}ms.`,
					"WRITER_UNAVAILABLE",
				);
			}
		}
		this.startPromise = undefined;
		this.lastHealth = undefined;
		this.spawnedPid = undefined;
		this.spawnedExit = undefined;
		ownedWriterClients.delete(this);
	}

	shutdownIfOwned(): number | undefined {
		if (
			!this.spawnedPid ||
			this.lastHealth?.pid !== this.spawnedPid ||
			!processExists(this.spawnedPid)
		) {
			return undefined;
		}
		try {
			const owner = JSON.parse(
				readFileSync(`${writerLockPath(this.databaseUrl)}/owner.json`, "utf8"),
			) as { pid?: unknown; writerInstanceId?: unknown };
			if (
				owner.pid !== this.spawnedPid ||
				owner.writerInstanceId !== this.lastHealth.writerInstanceId
			) {
				return undefined;
			}
		} catch {
			return undefined;
		}
		const pid = this.spawnedPid;
		try {
			process.kill(pid, "SIGTERM");
			return pid;
		} catch {
			return undefined;
		}
	}

	private async ensureStarted(): Promise<WriterHealth> {
		if (this.startPromise) return await this.startPromise;
		this.startPromise = this.connectOrStart().catch((error) => {
			this.startPromise = undefined;
			throw error;
		});
		return await this.startPromise;
	}

	private async connectOrStart(): Promise<WriterHealth> {
		try {
			return await this.health();
		} catch (firstError) {
			if (
				firstError instanceof SqliteWriterClientError &&
				firstError.code !== "WRITER_UNAVAILABLE"
			) {
				throw firstError;
			}
			if (this.options.autoStart === false) {
				throw new SqliteWriterClientError(
					"SQLite Writer is unavailable and autostart is disabled.",
					"WRITER_UNAVAILABLE",
				);
			}
			await this.recoverStaleWriterArtifacts();
			try {
				this.spawnWriter();
			} catch (error) {
				throw new SqliteWriterClientError(
					`Failed to start SQLite Writer: ${error instanceof Error ? error.message : String(error)}`,
					"WRITER_UNAVAILABLE",
				);
			}
			const timeoutMs =
				this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
			const deadline = Date.now() + timeoutMs;
			let lastError: unknown = firstError;
			while (Date.now() < deadline) {
				try {
					const health = await this.health();
					await this.waitForRedundantSpawnToExit(health, deadline);
					return health;
				} catch (error) {
					lastError = error;
					await delay(25);
				}
			}
			throw new SqliteWriterClientError(
				`SQLite Writer did not become ready within ${timeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
				"WRITER_START_TIMEOUT",
			);
		}
	}

	private async waitForRedundantSpawnToExit(
		health: WriterHealth,
		deadline: number,
	): Promise<void> {
		const spawnedPid = this.spawnedPid;
		const spawnedExit = this.spawnedExit;
		if (!spawnedPid || spawnedPid === health.pid || !spawnedExit) return;

		while (processExists(spawnedPid) && Date.now() < deadline) {
			await Promise.race([spawnedExit, delay(20)]);
		}
		if (processExists(spawnedPid)) {
			throw new SqliteWriterClientError(
				`Redundant SQLite Writer ${spawnedPid} did not exit after Writer ${health.pid} became ready.`,
				"WRITER_START_TIMEOUT",
			);
		}
		this.spawnedPid = undefined;
		this.spawnedExit = undefined;
		ownedWriterClients.delete(this);
	}

	private async recoverStaleWriterArtifacts(): Promise<void> {
		const lockPath = writerLockPath(this.databaseUrl);
		let owner: { pid?: unknown; databaseId?: unknown } | undefined;
		try {
			owner = await Bun.file(`${lockPath}/owner.json`).json();
		} catch {
			try {
				const ageMs = Date.now() - statSync(lockPath).mtimeMs;
				if (ageMs > 5_000) {
					rmSync(lockPath, { recursive: true, force: true });
					rmSync(this.socketPath, { force: true });
				}
			} catch {
				// No lock exists, or another process completed cleanup first.
			}
			return;
		}
		if (!owner) return;
		if (owner.databaseId !== this.databaseId) return;
		if (typeof owner.pid === "number" && processExists(owner.pid)) return;
		rmSync(lockPath, { recursive: true, force: true });
		rmSync(this.socketPath, { force: true });
	}

	private spawnWriter(): void {
		const writerEntrypoint = fileURLToPath(
			new URL("../../cli/sqlite-writer.ts", import.meta.url),
		);
		const child = Bun.spawn(
			[
				process.execPath,
				writerEntrypoint,
				"--database-url",
				this.databaseUrl,
				"--socket",
				this.socketPath,
			],
			{
				cwd: process.cwd(),
				detached: process.env.SQLITE_WRITER_DETACHED !== "0",
				stdio: ["ignore", "ignore", "ignore"],
				env: {
					...process.env,
					DATABASE_URL: this.databaseUrl,
					SQLITE_WRITER_SOCKET: this.socketPath,
					SQLITE_WRITER_AUTOSTART: "0",
				},
			},
		);
		this.spawnedPid = child.pid;
		this.spawnedExit = child.exited;
		ownedWriterClients.add(this);
		if (process.env.SQLITE_WRITER_DETACHED !== "0") child.unref();
	}

	private async sendRaw(
		request: WriterRequest,
		timeoutMs = this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<WriterResponse> {
		let response: Response;
		try {
			response = await fetch("http://localhost/rpc", {
				unix: this.socketPath,
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-sqlite-writer-request-id": request.requestId,
				},
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(timeoutMs),
			} satisfies FetchUnixInit);
		} catch (error) {
			const timedOut =
				error instanceof DOMException && error.name === "TimeoutError";
			const timeoutOutcome =
				request.kind === "health"
					? "Writer health is unknown"
					: "the mutation result is unknown";
			throw new SqliteWriterClientError(
				timedOut
					? `SQLite Writer request timed out after ${timeoutMs}ms; ${timeoutOutcome}.`
					: error instanceof Error
						? error.message
						: "SQLite Writer is unavailable.",
				timedOut ? "WRITER_RESULT_UNKNOWN" : "WRITER_UNAVAILABLE",
			);
		}

		let parsedPayload: ReturnType<typeof writerResponseSchema.parse>;
		try {
			parsedPayload = writerResponseSchema.parse(await response.json());
		} catch {
			throw new SqliteWriterClientError(
				"SQLite Writer returned an invalid response.",
				"WRITER_RESULT_UNKNOWN",
			);
		}
		if (parsedPayload.protocolVersion !== WRITER_PROTOCOL_VERSION) {
			throw new SqliteWriterClientError(
				"SQLite Writer protocol version mismatch.",
				"WRITER_PROTOCOL_MISMATCH",
			);
		}
		const payload = parsedPayload as WriterResponse;
		if (payload.requestId !== request.requestId) {
			throw new SqliteWriterClientError(
				"SQLite Writer response request identity mismatch.",
				"WRITER_RESULT_UNKNOWN",
			);
		}
		if (!payload.ok) {
			throw new SqliteWriterClientError(
				payload.error?.message ?? "SQLite Writer request failed.",
				payload.error?.code === "WRITER_DATABASE_MISMATCH"
					? "WRITER_DATABASE_MISMATCH"
					: "WRITER_REQUEST_FAILED",
				payload.error?.sqliteCode,
				payload.error?.code,
			);
		}
		return payload;
	}
}

export function getSqliteWriterClient(
	databaseUrl: string,
	options?: ConstructorParameters<typeof SqliteWriterClient>[1],
): SqliteWriterClient {
	return new SqliteWriterClient(databaseUrl, options);
}

export async function closeOwnedSqliteWriterClients(): Promise<void> {
	const results = await Promise.allSettled(
		[...ownedWriterClients].map((client) =>
			client.close({ shutdownIfOwned: true }),
		),
	);
	const errors = results
		.filter(
			(result): result is PromiseRejectedResult => result.status === "rejected",
		)
		.map((result) => result.reason);
	if (errors.length > 0) {
		throw new AggregateError(errors, "Failed to stop owned SQLite Writers.");
	}
}
