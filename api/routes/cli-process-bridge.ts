import { HttpError } from "../modules/auth/errors";
import { runBoundedProcess } from "../modules/processes/bounded-process-runner";
import type { WebProcessCapacity } from "../modules/processes/web-process-capacity";

export function parseCliJsonObject(
	result: { stdout: string; stderr: string; exitCode: number },
	label: string,
): Record<string, unknown> {
	try {
		const parsed = JSON.parse(result.stdout.trim());
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Report a generic bridge error below without reflecting child output.
	}
	console.error(`${label} returned an invalid JSON response.`, {
		exitCode: result.exitCode,
		stdoutBytes: Buffer.byteLength(result.stdout),
		stderrBytes: Buffer.byteLength(result.stderr),
	});
	throw new HttpError(500, `${label} returned an invalid response.`);
}

export async function runBoundedCliProcess(params: {
	argv: string[];
	processCapacity?: WebProcessCapacity;
	timeoutMs: number;
	outputLimitBytes: number;
	label: string;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const releaseCapacity = params.processCapacity?.tryAcquire();
	if (params.processCapacity && !releaseCapacity) {
		throw new HttpError(
			429,
			"Local execution capacity is full. Retry after an active process completes.",
		);
	}

	let result: Awaited<ReturnType<typeof runBoundedProcess>>;
	try {
		result = await runBoundedProcess({
			argv: params.argv,
			timeoutMs: params.timeoutMs,
			outputLimitBytes: params.outputLimitBytes,
		});
	} finally {
		releaseCapacity?.();
	}
	if (result.terminationReason) {
		const reason = result.terminationReason;
		throw new HttpError(
			500,
			reason === "timeout"
				? `${params.label} execution timed out.`
				: reason === "stdout_limit" || reason === "stderr_limit"
					? `${params.label} ${reason === "stdout_limit" ? "stdout" : "stderr"} exceeded ${params.outputLimitBytes} bytes.`
					: reason === "aborted"
						? `${params.label} execution was cancelled.`
						: `${params.label} process monitoring failed.`,
		);
	}
	return {
		stdout: result.stdout,
		stderr: result.stderr,
		exitCode: result.exitCode ?? -1,
	};
}
