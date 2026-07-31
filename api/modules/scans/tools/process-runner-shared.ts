export type PipeSubprocess = {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill(signal?: string): void;
};

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function parsePositiveInteger(
	value: string | number | undefined,
	label: string,
	fallback: number,
	maximum: number,
): number {
	const parsed =
		typeof value === "number" ? value : value ? Number(value) : fallback;
	if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
		throw new Error(
			`${label} must be a positive integer no greater than ${maximum}.`,
		);
	}
	return parsed;
}
