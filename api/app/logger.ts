import { AsyncLocalStorage } from "node:async_hooks";

const logContext = new AsyncLocalStorage<{
	requestId?: string;
	scanRunId?: string;
}>();
export function withLogContext<T>(
	context: { requestId?: string; scanRunId?: string },
	operation: () => T,
): T {
	return logContext.run({ ...logContext.getStore(), ...context }, operation);
}

export type LogEvent = {
	level: "debug" | "info" | "warn" | "error";
	event: string;
	scanRunId?: string;
	requestId?: string;
	durationMs?: number;
	errorCode?: string;
};

/** An allowlist, not arbitrary error serialization: no prompts, paths or secrets. */
export function createLogger(write: (line: string) => void) {
	return (entry: LogEvent): void => {
		try {
			const identifier = (value: string | undefined) =>
				value && /^[\w.:-]{1,128}$/.test(value) ? value : undefined;
			write(
				JSON.stringify({
					version: 1,
					timestamp: new Date().toISOString(),
					level: entry.level,
					event: identifier(entry.event) ?? "invalid_event",
					scanRunId: identifier(
						entry.scanRunId ?? logContext.getStore()?.scanRunId,
					),
					requestId: identifier(
						entry.requestId ?? logContext.getStore()?.requestId,
					),
					errorCode: identifier(entry.errorCode),
					durationMs:
						typeof entry.durationMs === "number" &&
						Number.isFinite(entry.durationMs) &&
						entry.durationMs >= 0
							? Math.round(entry.durationMs)
							: undefined,
				}),
			);
		} catch {
			/* Observability must never change the operation outcome. */
		}
	};
}

// stderr preserves machine-readable CLI result streams on stdout.
export const logEvent = createLogger((line) => {
	process.stderr.write(`${line}\n`);
});
