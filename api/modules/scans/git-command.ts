import { spawn } from "node:child_process";

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
	return await new Promise((resolve, reject) => {
		const child = spawn("git", [...params.args], {
			cwd: params.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				PATH: process.env.PATH,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_TERMINAL_PROMPT: "0",
				LC_ALL: "C",
			},
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let outputBytes = 0;
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let unregisterGitInterrupt = () => {};
		const finishWithError = (
			message: string,
			exitCode: number | null = null,
		) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			unregisterGitInterrupt();
			child.kill("SIGKILL");
			reject(
				new GitCommandError(
					message,
					params.args,
					exitCode,
					Buffer.concat(stderr).toString("utf8"),
				),
			);
		};
		const append = (chunks: Buffer[], chunk: Buffer) => {
			outputBytes += chunk.length;
			if (outputBytes > maxBufferBytes) {
				finishWithError("Git command output exceeded the configured limit.");
				return;
			}
			chunks.push(chunk);
		};
		child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
		child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
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
			unregisterGitInterrupt();
			const exitCode = code ?? -1;
			const stderrText = Buffer.concat(stderr).toString("utf8");
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
				stdout: Buffer.concat(stdout),
				stderr: stderrText,
				exitCode,
			});
		});
		timer = setTimeout(() => {
			finishWithError(`Git command timed out after ${timeoutMs}ms.`);
		}, timeoutMs);
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
