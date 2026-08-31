import { readBoundedProcessText } from "../scans/tools/bounded-process-output";

export type BoundedProcessTerminationReason =
	| "timeout"
	| "stdout_limit"
	| "stderr_limit"
	| "aborted"
	| "monitor_error";

export type BoundedProcessResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	terminationReason: BoundedProcessTerminationReason | null;
};

const DEFAULT_TERMINATION_GRACE_MS = 2_000;

export async function runBoundedProcess(params: {
	argv: string[];
	timeoutMs: number;
	outputLimitBytes: number;
	stdin?: string;
	signal?: AbortSignal | null;
	terminationGraceMs?: number;
	env?: Record<string, string | undefined>;
}): Promise<BoundedProcessResult> {
	if (params.argv.length === 0) {
		throw new Error("Process argv must not be empty.");
	}
	if (!Number.isSafeInteger(params.timeoutMs) || params.timeoutMs <= 0) {
		throw new Error("Process timeout must be a positive safe integer.");
	}
	if (
		!Number.isSafeInteger(params.outputLimitBytes) ||
		params.outputLimitBytes <= 0
	) {
		throw new Error("Process output limit must be a positive safe integer.");
	}
	const terminationGraceMs =
		params.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
	if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
		throw new Error(
			"Process termination grace must be a non-negative safe integer.",
		);
	}
	if (params.signal?.aborted) {
		return {
			exitCode: null,
			stdout: "",
			stderr: "",
			terminationReason: "aborted",
		};
	}

	const proc =
		params.stdin === undefined
			? Bun.spawn(params.argv, {
					stdout: "pipe",
					stderr: "pipe",
					env: params.env,
				})
			: Bun.spawn(params.argv, {
					stdin: "pipe",
					stdout: "pipe",
					stderr: "pipe",
					env: params.env,
				});
	let terminationReason: BoundedProcessTerminationReason | null = null;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	let hardStopTimer: ReturnType<typeof setTimeout> | undefined;
	let resolveHardStop!: (value: { kind: "hard_stop" }) => void;
	const hardStop = new Promise<{ kind: "hard_stop" }>((resolve) => {
		resolveHardStop = resolve;
	});
	const kill = (signal: "SIGTERM" | "SIGKILL") => {
		try {
			proc.kill(signal);
		} catch {
			// The child may have exited between the state check and signal delivery.
		}
	};
	const terminate = (reason: BoundedProcessTerminationReason) => {
		if (terminationReason) return;
		terminationReason = reason;
		kill("SIGTERM");
		killTimer = setTimeout(() => kill("SIGKILL"), terminationGraceMs);
		hardStopTimer = setTimeout(() => {
			kill("SIGKILL");
			resolveHardStop({ kind: "hard_stop" });
		}, terminationGraceMs + 1_000);
	};
	const onAbort = () => terminate("aborted");
	params.signal?.addEventListener("abort", onAbort, { once: true });

	const timeout = setTimeout(() => terminate("timeout"), params.timeoutMs);
	let stdout = "";
	let stderr = "";
	let exitCode: number | null = null;
	try {
		if (params.stdin !== undefined) {
			const stdin = proc.stdin;
			if (!stdin || typeof stdin === "number") {
				throw new Error("Process stdin pipe is unavailable.");
			}
			stdin.write(params.stdin);
			stdin.end();
		}
		const stdoutStream =
			typeof proc.stdout === "number" ? undefined : proc.stdout;
		const stderrStream =
			typeof proc.stderr === "number" ? undefined : proc.stderr;
		const monitoring = Promise.all([
			readBoundedProcessText(stdoutStream, params.outputLimitBytes, () =>
				terminate("stdout_limit"),
			),
			readBoundedProcessText(stderrStream, params.outputLimitBytes, () =>
				terminate("stderr_limit"),
			),
			proc.exited,
		]).then(
			([stdoutResult, stderrResult, code]) => ({
				kind: "completed" as const,
				stdoutResult,
				stderrResult,
				code,
			}),
			(error: unknown) => ({ kind: "monitor_error" as const, error }),
		);
		const outcome = await Promise.race([monitoring, hardStop]);
		if (outcome.kind === "completed") {
			stdout = outcome.stdoutResult.text;
			stderr = outcome.stderrResult.text;
			exitCode = outcome.code;
		} else if (outcome.kind === "monitor_error") {
			terminate("monitor_error");
			await Promise.race([
				proc.exited.then(
					() => undefined,
					() => undefined,
				),
				hardStop,
			]);
		}
	} catch {
		terminate("monitor_error");
		await Promise.race([
			proc.exited.then(
				() => undefined,
				() => undefined,
			),
			hardStop,
		]);
	} finally {
		clearTimeout(timeout);
		if (killTimer) clearTimeout(killTimer);
		if (hardStopTimer) clearTimeout(hardStopTimer);
		params.signal?.removeEventListener("abort", onAbort);
	}

	return {
		exitCode: terminationReason ? null : exitCode,
		stdout,
		stderr,
		terminationReason,
	};
}
