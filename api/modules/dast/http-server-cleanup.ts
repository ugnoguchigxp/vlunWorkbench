import type http from "node:http";

const SERVER_CLEANUP_TIMEOUT_MS = 5_000;

export async function awaitCleanupBounded<T>(
	promise: Promise<T>,
	failureCode: string,
	timeoutMs = SERVER_CLEANUP_TIMEOUT_MS,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(failureCode)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export async function closeHttpServerBounded(
	server: http.Server,
	failureCode: string,
): Promise<void> {
	const closePromise = new Promise<void>((resolve, reject) => {
		try {
			server.close((error) => (error ? reject(error) : resolve()));
			server.closeIdleConnections();
			server.closeAllConnections();
		} catch (error) {
			reject(error);
		}
	});
	try {
		await awaitCleanupBounded(closePromise, failureCode);
	} catch (error) {
		throw new Error(failureCode, { cause: error });
	}
}
