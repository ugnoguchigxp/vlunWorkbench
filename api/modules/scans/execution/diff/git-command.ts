import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const activeGitInterrupts = new Set<() => void>();
let removeGitSignalHandlers: (() => void) | null = null;

function registerGitInterrupt(interrupt: () => void): () => void {
	if (activeGitInterrupts.size === 0) {
		const hadSigtermListener = process.listenerCount("SIGTERM") > 0;
		const hadSigintListener = process.listenerCount("SIGINT") > 0;
		const handleSignal = (
			signal: "SIGTERM" | "SIGINT",
			hadExistingListener: boolean,
		) => {
			for (const activeInterrupt of [...activeGitInterrupts]) {
				activeInterrupt();
			}
			if (!hadExistingListener) {
				removeGitSignalHandlers?.();
				process.kill(process.pid, signal);
			}
		};
		const handleSigterm = () => handleSignal("SIGTERM", hadSigtermListener);
		const handleSigint = () => handleSignal("SIGINT", hadSigintListener);
		removeGitSignalHandlers = () => {
			process.off("SIGTERM", handleSigterm);
			process.off("SIGINT", handleSigint);
			removeGitSignalHandlers = null;
		};
		process.once("SIGTERM", handleSigterm);
		process.once("SIGINT", handleSigint);
	}
	activeGitInterrupts.add(interrupt);
	return () => {
		activeGitInterrupts.delete(interrupt);
		if (activeGitInterrupts.size === 0) {
			removeGitSignalHandlers?.();
		}
	};
}

export class GitCommandError extends Error {
	constructor(
		message: string,
		readonly args: readonly string[],
		readonly exitCode: number | null,
		readonly stderr: string,
	) {
		super(message);
		this.name = "GitCommandError";
	}
}

export async function runGitCommand(params: {
	cwd: string;
	args: readonly string[];
	input?: Buffer | string;
	timeoutMs?: number;
	maxBufferBytes?: number;
	allowedExitCodes?: readonly number[];
}): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
	const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBufferBytes = params.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
	const allowedExitCodes = new Set(params.allowedExitCodes ?? [0]);
	const captureRoot = mkdtempSync(path.join(os.tmpdir(), "vwb-git-command-"));
	const stdoutPath = path.join(captureRoot, "stdout");
	const stderrPath = path.join(captureRoot, "stderr");
	return await new Promise((resolve, reject) => {
		const child = spawn(
			"/bin/sh",
			[
				"-c",
				'stdout_path=$1; stderr_path=$2; shift 2; exec git "$@" >"$stdout_path" 2>"$stderr_path"',
				"vwb-git-command",
				stdoutPath,
				stderrPath,
				"-C",
				params.cwd,
				...params.args,
			],
			{
				stdio: ["pipe", "ignore", "ignore"],
				env: {
					PATH: process.env.PATH,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_TERMINAL_PROMPT: "0",
					LC_ALL: "C",
				},
			},
		);
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let outputTimer: ReturnType<typeof setInterval> | undefined;
		let unregisterGitInterrupt = () => {};
		const finishWithError = (
			message: string,
			exitCode: number | null = null,
		) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (outputTimer) clearInterval(outputTimer);
			unregisterGitInterrupt();
			child.kill("SIGKILL");
			const stderr = readCaptured(stderrPath);
			rmSync(captureRoot, { recursive: true, force: true });
			reject(
				new GitCommandError(
					message,
					params.args,
					exitCode,
					stderr.toString("utf8"),
				),
			);
		};
		child.on("error", (error) => {
			finishWithError(`Failed to start Git: ${error.message}`);
		});
		child.stdin.on("error", (error) => {
			if (params.input !== undefined) {
				finishWithError(`Failed to write Git command input: ${error.message}`);
			}
		});
		child.on("close", (code) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			if (outputTimer) clearInterval(outputTimer);
			unregisterGitInterrupt();
			const exitCode = code ?? -1;
			const stdout = readCaptured(stdoutPath);
			const stderr = readCaptured(stderrPath);
			rmSync(captureRoot, { recursive: true, force: true });
			const stderrText = stderr.toString("utf8");
			if (stdout.length + stderr.length > maxBufferBytes) {
				reject(
					new GitCommandError(
						"Git command output exceeded the configured limit.",
						params.args,
						exitCode,
						stderrText,
					),
				);
				return;
			}
			if (!allowedExitCodes.has(exitCode)) {
				reject(
					new GitCommandError(
						`Git command exited with code ${exitCode}.`,
						params.args,
						code,
						stderrText,
					),
				);
				return;
			}
			resolve({
				stdout,
				stderr: stderrText,
				exitCode,
			});
		});
		timer = setTimeout(() => {
			finishWithError(`Git command timed out after ${timeoutMs}ms.`);
		}, timeoutMs);
		outputTimer = setInterval(() => {
			if (
				capturedSize(stdoutPath) + capturedSize(stderrPath) >
				maxBufferBytes
			) {
				finishWithError("Git command output exceeded the configured limit.");
			}
		}, 25);
		outputTimer.unref();
		unregisterGitInterrupt = registerGitInterrupt(() => {
			finishWithError("Git command was interrupted.");
		});
		if (params.input !== undefined) {
			child.stdin.end(params.input);
		} else {
			child.stdin.end();
		}
	});
}

function capturedSize(filePath: string): number {
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

function readCaptured(filePath: string): Buffer {
	try {
		return readFileSync(filePath);
	} catch {
		return Buffer.alloc(0);
	}
}

export async function runGitText(params: {
	cwd: string;
	args: readonly string[];
	input?: Buffer | string;
	timeoutMs?: number;
	maxBufferBytes?: number;
	allowedExitCodes?: readonly number[];
}): Promise<string> {
	const result = await runGitCommand(params);
	return result.stdout.toString("utf8");
}
