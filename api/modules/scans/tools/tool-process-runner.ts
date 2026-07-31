import fs from "node:fs/promises";
import { readBoundedProcessText } from "./bounded-process-output";
import { runDockerToolProcess } from "./docker-tool-process-runner";
import {
	errorMessage,
	getCleanEnv,
	type PipeSubprocess,
} from "./process-runner-shared";
import { emitLifecycleEvent } from "./tool-lifecycle";
import {
	normalizeToolExecutionConfig,
	resolveProcessOutputLimits,
} from "./tool-process-policy";
import type {
	ProcessRunnerOptions,
	ProcessRunnerResult,
} from "./tool-process-types";

export { getCleanEnv } from "./process-runner-shared";
export {
	DEFAULT_PROCESS_OUTPUT_LIMITS,
	normalizeToolExecutionConfig,
	resolveProcessOutputLimits,
} from "./tool-process-policy";
export type {
	DockerNetworkMode,
	DockerRunnerConfig,
	ProcessOutputLimits,
	ProcessRunnerOptions,
	ProcessRunnerResult,
	ToolExecutionConfig,
	ToolLifecycleEvent,
	ToolRunnerKind,
} from "./tool-process-types";

export async function checkToolVersion(
	binaryName: string,
	versionArgs: string[] = ["--version"],
	options: Pick<
		ProcessRunnerOptions,
		"execution" | "env" | "timeoutSec" | "onLifecycleEvent"
	> = {},
): Promise<string | null> {
	const execution = normalizeToolExecutionConfig(options.execution);
	const result = await runToolProcess(binaryName, versionArgs, {
		timeoutSec: options.timeoutSec ?? 30,
		env: options.env,
		execution,
		onLifecycleEvent: options.onLifecycleEvent,
	});
	if (!result.ok) {
		if (execution.runner === "docker") {
			throw new Error(result.error ?? "Docker tool version check failed");
		}
		return null;
	}
	if (result.exitCode !== 0) {
		if (execution.runner === "docker") {
			const detail =
				result.stderr.trim() || result.stdout.trim() || "no output";
			throw new Error(
				`Docker tool version check failed for ${binaryName}: ${detail}`,
			);
		}
		return null;
	}
	return result.stdout.trim() || result.stderr.trim();
}

export async function runToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions = {},
): Promise<ProcessRunnerResult> {
	const execution = normalizeToolExecutionConfig(options.execution);
	const outputLimits = options.outputLimits ?? execution.outputLimits;
	const resolvedOptions = { ...options, outputLimits };
	const result =
		execution.runner === "docker"
			? await runDockerToolProcess(binaryName, args, resolvedOptions, execution)
			: await runHostToolProcess(binaryName, args, resolvedOptions);
	if (!result.ok || !options.outputPath) {
		return result;
	}
	const resolvedOutputLimits = resolveProcessOutputLimits(outputLimits);
	const outputStat = await fs.stat(options.outputPath).catch(() => null);
	if (!outputStat || outputStat.size <= resolvedOutputLimits.stdoutBytes) {
		return result;
	}
	await emitLifecycleEvent(options.onLifecycleEvent, {
		level: "error",
		eventType: "tool.output_file.limit_exceeded",
		message: `${binaryName} structured output exceeded its byte limit.`,
		data: {
			outputBytes: outputStat.size,
			limitBytes: resolvedOutputLimits.stdoutBytes,
		},
	});
	return {
		...result,
		ok: false,
		error: `tool_output_limit_exceeded: ${binaryName} output file exceeded ${resolvedOutputLimits.stdoutBytes} bytes`,
		executionMetadata: {
			...result.executionMetadata,
			outputCapture: {
				...((result.executionMetadata?.outputCapture as Record<
					string,
					unknown
				>) ?? {}),
				outputFileBytes: outputStat.size,
				outputFileLimitBytes: resolvedOutputLimits.stdoutBytes,
				terminationReason: "output_file_limit",
			},
		},
	};
}

async function runHostToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions,
): Promise<ProcessRunnerResult> {
	const startTime = Date.now();
	const cleanEnv = options.env ?? getCleanEnv();
	const outputLimits = resolveProcessOutputLimits(options.outputLimits);
	let exitCode: number | null = null;
	let stdout = "";
	let stderr = "";
	let stdoutBytes = 0;
	let stderrBytes = 0;
	let proc: PipeSubprocess | undefined;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let killAfterTerminationId: ReturnType<typeof setTimeout> | undefined;
	let terminationReason: "timeout" | "stdout_limit" | "stderr_limit" | null =
		null;

	const terminate = (reason: "timeout" | "stdout_limit" | "stderr_limit") => {
		if (terminationReason) return;
		terminationReason = reason;
		proc?.kill("SIGTERM");
		killAfterTerminationId = setTimeout(() => {
			proc?.kill("SIGKILL");
		}, 2_000);
	};

	try {
		proc = Bun.spawn([binaryName, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: cleanEnv,
		}) as PipeSubprocess;

		const timeoutSec = options.timeoutSec ?? 300;
		timeoutId = setTimeout(() => {
			terminate("timeout");
		}, timeoutSec * 1000);

		const [stdoutResult, stderrResult, code] = await Promise.all([
			readBoundedProcessText(proc.stdout, outputLimits.stdoutBytes, () =>
				terminate("stdout_limit"),
			),
			readBoundedProcessText(proc.stderr, outputLimits.stderrBytes, () =>
				terminate("stderr_limit"),
			),
			proc.exited,
		]);

		exitCode = code;
		stdout = stdoutResult.text;
		stderr = stderrResult.text;
		stdoutBytes = stdoutResult.bytesRead;
		stderrBytes = stderrResult.bytesRead;
	} catch (err: unknown) {
		const message = errorMessage(err);
		const terminationError =
			terminationReason === "stdout_limit"
				? `tool_output_limit_exceeded: ${binaryName} stdout exceeded ${outputLimits.stdoutBytes} bytes`
				: terminationReason === "stderr_limit"
					? `tool_stderr_limit_exceeded: ${binaryName} stderr exceeded ${outputLimits.stderrBytes} bytes`
					: terminationReason === "timeout"
						? `${binaryName} execution timed out`
						: null;
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || message,
			elapsedMs: Date.now() - startTime,
			error: terminationError ?? `Process error: ${message}`,
			executionMetadata: {
				runner: "host",
				outputCapture: {
					limits: outputLimits,
					stdoutBytes,
					stderrBytes,
					terminationReason,
				},
			},
		};
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (killAfterTerminationId) {
			clearTimeout(killAfterTerminationId);
		}
		if (proc && exitCode === null && !terminationReason) proc.kill("SIGKILL");
	}

	const elapsedMs = Date.now() - startTime;

	if (terminationReason) {
		const error =
			terminationReason === "stdout_limit"
				? `tool_output_limit_exceeded: ${binaryName} stdout exceeded ${outputLimits.stdoutBytes} bytes`
				: terminationReason === "stderr_limit"
					? `tool_stderr_limit_exceeded: ${binaryName} stderr exceeded ${outputLimits.stderrBytes} bytes`
					: `${binaryName} execution timed out`;
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			error,
			executionMetadata: {
				runner: "host",
				outputCapture: {
					limits: outputLimits,
					stdoutBytes,
					stderrBytes,
					terminationReason,
				},
			},
		};
	}

	return {
		ok: true,
		exitCode,
		stdout,
		stderr,
		elapsedMs,
		executionMetadata: {
			runner: "host",
			outputCapture: {
				limits: outputLimits,
				stdoutBytes,
				stderrBytes,
				terminationReason: null,
			},
		},
	};
}
