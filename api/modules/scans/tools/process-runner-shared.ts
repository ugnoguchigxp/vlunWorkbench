export type PipeSubprocess = {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill(signal?: string): void;
};

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function getCleanEnv(): Record<string, string> {
	const cleanEnv: Record<string, string> = {};
	for (const [key, val] of Object.entries(process.env)) {
		const normalizedKey = key.toUpperCase();
		if (
			val &&
			!normalizedKey.includes("OPENAI") &&
			!normalizedKey.includes("AZURE") &&
			!normalizedKey.includes("LLM") &&
			!normalizedKey.includes("SECRET") &&
			!normalizedKey.includes("KEY") &&
			!normalizedKey.includes("TOKEN") &&
			!normalizedKey.includes("PASSWORD") &&
			!normalizedKey.includes("PRIVATE") &&
			!normalizedKey.includes("CREDENTIAL")
		) {
			cleanEnv[key] = val;
		}
	}
	return cleanEnv;
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
