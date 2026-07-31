import type { WriterErrorCode } from "./protocol";

export type FetchUnixInit = RequestInit & { unix: string };

export class SqliteWriterClientError extends Error {
	constructor(
		message: string,
		readonly code:
			| "WRITER_UNAVAILABLE"
			| "WRITER_START_TIMEOUT"
			| "WRITER_PROTOCOL_MISMATCH"
			| "WRITER_DATABASE_MISMATCH"
			| "WRITER_REQUEST_FAILED"
			| "WRITER_RESULT_UNKNOWN",
		readonly sqliteCode?: string,
		readonly writerCode?: WriterErrorCode,
	) {
		super(message);
		this.name = "SqliteWriterClientError";
	}
}

export function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function delay(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}
