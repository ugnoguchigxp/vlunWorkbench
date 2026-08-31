import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

type BunSpawn = typeof Bun.spawn;
type BunSpawnOptions = NonNullable<Parameters<BunSpawn>[1]>;

/**
 * Bun 1.3 on recent macOS can return empty child-process pipes under `bun test`.
 * Keep this compatibility layer test-only and capture bytes through child-side
 * file redirection, which preserves exit status, stdin, cwd, and environment.
 */
export function installBunTestSubprocessCapture(): void {
	if (process.platform !== "darwin") return;
	installBunSpawnCapture();
	installBunSpawnSyncCapture();
	installNodeAsyncCapture();
	installNodeSyncCapture();
}

function installBunSpawnCapture(): void {
	const originalSpawn = Bun.spawn.bind(Bun) as BunSpawn;
	const wrapped = ((...spawnArgs: unknown[]) => {
		const command = spawnArgs[0];
		if (Array.isArray(command)) {
			const options = (spawnArgs[1] ?? {}) as BunSpawnOptions;
			if (
				options.stdin === "pipe" ||
				command.includes("--remote-debugging-pipe")
			) {
				return originalSpawn(command, options);
			}
			const stdoutPiped =
				options.stdout === "pipe" || options.stdout === undefined;
			const stderrPiped =
				options.stderr === "pipe" || options.stderr === undefined;
			if (!stdoutPiped && !stderrPiped) return originalSpawn(command, options);
			return spawnWithCapturedOutput({
				originalSpawn,
				command,
				options,
				stdoutPiped,
				stderrPiped,
			});
		}
		return Reflect.apply(
			originalSpawn as unknown as (...args: unknown[]) => unknown,
			Bun,
			spawnArgs,
		);
	}) as unknown as BunSpawn;
	(Bun as unknown as { spawn: BunSpawn }).spawn = wrapped;
}

function spawnWithCapturedOutput(params: {
	originalSpawn: BunSpawn;
	command: string[];
	options: BunSpawnOptions;
	stdoutPiped: boolean;
	stderrPiped: boolean;
}) {
	const capture = createCaptureRoot();
	const redirected = redirectedCommand(
		params.command,
		capture.stdoutPath,
		capture.stderrPath,
	);
	const child = params.originalSpawn(redirected, {
		...params.options,
		stdout: "ignore",
		stderr: "ignore",
	});
	const captured = child.exited.then((exitCode) => {
		const stdout = readCapture(capture.stdoutPath);
		const stderr = readCapture(capture.stderrPath);
		capture.remove();
		return { exitCode, stdout, stderr };
	});
	const stdout = params.stdoutPiped
		? capturedStream(captured.then((entry) => entry.stdout))
		: child.stdout;
	const stderr = params.stderrPiped
		? capturedStream(captured.then((entry) => entry.stderr))
		: child.stderr;
	return new Proxy(child, {
		get(target, property) {
			if (property === "stdout") return stdout;
			if (property === "stderr") return stderr;
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

function installBunSpawnSyncCapture(): void {
	type BunSpawnSync = typeof Bun.spawnSync;
	type BunSpawnSyncOptions = NonNullable<Parameters<BunSpawnSync>[1]>;
	const originalSpawnSync = Bun.spawnSync.bind(Bun) as BunSpawnSync;
	const wrapped = ((...spawnArgs: unknown[]) => {
		const command = spawnArgs[0];
		if (!Array.isArray(command)) {
			return Reflect.apply(
				originalSpawnSync as unknown as (...args: unknown[]) => unknown,
				Bun,
				spawnArgs,
			);
		}
		const options = (spawnArgs[1] ?? {}) as BunSpawnSyncOptions;
		const stdoutPiped =
			options.stdout === "pipe" || options.stdout === undefined;
		const stderrPiped =
			options.stderr === "pipe" || options.stderr === undefined;
		if (!stdoutPiped && !stderrPiped) {
			return originalSpawnSync(command, options);
		}
		const capture = createCaptureRoot();
		try {
			const result = originalSpawnSync(
				redirectedCommand(command, capture.stdoutPath, capture.stderrPath),
				{
					...options,
					stdout: "ignore",
					stderr: "ignore",
				},
			);
			const stdout = stdoutPiped
				? readCapture(capture.stdoutPath)
				: result.stdout;
			const stderr = stderrPiped
				? readCapture(capture.stderrPath)
				: result.stderr;
			return new Proxy(result, {
				get(target, property) {
					if (property === "stdout") return stdout;
					if (property === "stderr") return stderr;
					const value = Reflect.get(target, property, target);
					return typeof value === "function" ? value.bind(target) : value;
				},
			});
		} finally {
			capture.remove();
		}
	}) as unknown as BunSpawnSync;
	(Bun as unknown as { spawnSync: BunSpawnSync }).spawnSync = wrapped;
}

function installNodeSyncCapture(): void {
	const require = createRequire(import.meta.url);
	const childProcess = require("node:child_process") as {
		execFileSync: (...args: unknown[]) => Buffer | string;
		execSync: (...args: unknown[]) => Buffer | string;
		spawnSync: (...args: unknown[]) => NodeSpawnSyncResult;
	};
	const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
	const robustSpawnSync = (
		file: unknown,
		argsOrOptions?: unknown,
		maybeOptions?: unknown,
	): NodeSpawnSyncResult => {
		const args = Array.isArray(argsOrOptions) ? argsOrOptions.map(String) : [];
		const options = (
			Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions
		) as NodeSpawnSyncOptions | undefined;
		if (
			options?.stdio === "ignore" ||
			options?.stdio === "inherit" ||
			(Array.isArray(options?.stdio) && !options.stdio.includes("pipe"))
		) {
			return originalSpawnSync(file, args, options) as NodeSpawnSyncResult;
		}
		const capture = createCaptureRoot();
		const result = originalSpawnSync(
			"/bin/sh",
			redirectedCommand(
				[String(file), ...args],
				capture.stdoutPath,
				capture.stderrPath,
			).slice(1),
			{
				...options,
				encoding: undefined,
				stdio: ["pipe", "ignore", "ignore"],
			},
		) as NodeSpawnSyncResult;
		const stdoutBytes = readCapture(capture.stdoutPath);
		const stderrBytes = readCapture(capture.stderrPath);
		capture.remove();
		const stdout = decodedCapture(stdoutBytes, options?.encoding);
		const stderr = decodedCapture(stderrBytes, options?.encoding);
		return {
			...result,
			stdout,
			stderr,
			output: [null, stdout, stderr],
		};
	};
	childProcess.spawnSync = robustSpawnSync;
	childProcess.execFileSync = (
		file: unknown,
		argsOrOptions?: unknown,
		maybeOptions?: unknown,
	) => {
		const result = robustSpawnSync(file, argsOrOptions, maybeOptions);
		return syncResult(result, optionsOf(argsOrOptions, maybeOptions));
	};
	childProcess.execSync = (command: unknown, options?: unknown) => {
		const result = robustSpawnSync("/bin/sh", ["-c", String(command)], options);
		return syncResult(result, options as NodeSpawnSyncOptions | undefined);
	};
	syncBuiltinESMExports();
}

function installNodeAsyncCapture(): void {
	type AsyncCallback = (
		error: (Error & Record<string, unknown>) | null,
		stdout: Buffer | string,
		stderr: Buffer | string,
	) => void;
	const require = createRequire(import.meta.url);
	const childProcess = require("node:child_process") as {
		execFile: (...args: unknown[]) => unknown;
		exec: (...args: unknown[]) => unknown;
	};
	const originalExecFile = childProcess.execFile.bind(childProcess);
	childProcess.execFile = (
		file: unknown,
		argsOrOptions?: unknown,
		optionsOrCallback?: unknown,
		maybeCallback?: unknown,
	) => {
		const args = Array.isArray(argsOrOptions) ? argsOrOptions.map(String) : [];
		const options = (
			Array.isArray(argsOrOptions)
				? typeof optionsOrCallback === "function"
					? undefined
					: optionsOrCallback
				: typeof argsOrOptions === "function"
					? undefined
					: argsOrOptions
		) as NodeAsyncOptions | undefined;
		const callback = (
			Array.isArray(argsOrOptions)
				? typeof optionsOrCallback === "function"
					? optionsOrCallback
					: maybeCallback
				: typeof argsOrOptions === "function"
					? argsOrOptions
					: optionsOrCallback
		) as AsyncCallback | undefined;
		return execFileCaptured({
			originalExecFile,
			command: [String(file), ...args],
			options,
			callback,
		});
	};
	childProcess.exec = (
		command: unknown,
		optionsOrCallback?: unknown,
		maybeCallback?: unknown,
	) => {
		const options = (
			typeof optionsOrCallback === "function" ? undefined : optionsOrCallback
		) as NodeAsyncOptions | undefined;
		const callback = (
			typeof optionsOrCallback === "function"
				? optionsOrCallback
				: maybeCallback
		) as AsyncCallback | undefined;
		return execFileCaptured({
			originalExecFile,
			command: ["/bin/sh", "-c", String(command)],
			options,
			callback,
		});
	};
	const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
	for (const method of [childProcess.execFile, childProcess.exec]) {
		Object.defineProperty(method, promisifyCustom, {
			configurable: true,
			value: (...args: unknown[]) =>
				new Promise((resolve, reject) => {
					method(
						...args,
						(
							error: Error | null,
							stdout: Buffer | string,
							stderr: Buffer | string,
						) => {
							if (error) reject(error);
							else resolve({ stdout, stderr });
						},
					);
				}),
		});
	}
	syncBuiltinESMExports();
}

type NodeAsyncOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	encoding?: BufferEncoding | "buffer" | null;
	maxBuffer?: number;
	signal?: AbortSignal;
	timeout?: number;
};

function execFileCaptured(params: {
	originalExecFile: (...args: unknown[]) => unknown;
	command: string[];
	options: NodeAsyncOptions | undefined;
	callback?: (
		error: (Error & Record<string, unknown>) | null,
		stdout: Buffer | string,
		stderr: Buffer | string,
	) => void;
}) {
	const capture = createCaptureRoot();
	const shellArgs = redirectedCommand(
		params.command,
		capture.stdoutPath,
		capture.stderrPath,
	).slice(1);
	const callback = params.callback ?? (() => {});
	return params.originalExecFile(
		"/bin/sh",
		shellArgs,
		params.options,
		(error: (Error & Record<string, unknown>) | null) => {
			const stdout = decodedCapture(
				readCapture(capture.stdoutPath),
				params.options?.encoding ?? "utf8",
			);
			const stderr = decodedCapture(
				readCapture(capture.stderrPath),
				params.options?.encoding ?? "utf8",
			);
			capture.remove();
			if (error) Object.assign(error, { stdout, stderr });
			callback(error, stdout, stderr);
		},
	);
}

type NodeSpawnSyncOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	encoding?: BufferEncoding | "buffer" | null;
	input?: string | Uint8Array;
	maxBuffer?: number;
	stdio?: unknown;
	timeout?: number;
};

type NodeSpawnSyncResult = {
	status: number | null;
	signal: NodeJS.Signals | null;
	stdout: Buffer | string | null;
	stderr: Buffer | string | null;
	error?: Error;
	pid?: number;
	output?: Array<Buffer | string | null>;
};

function syncResult(
	result: NodeSpawnSyncResult,
	options: NodeSpawnSyncOptions | undefined,
): Buffer | string {
	const stdoutBytes = Buffer.isBuffer(result.stdout)
		? result.stdout
		: Buffer.from(result.stdout ?? "");
	const stderrBytes = Buffer.isBuffer(result.stderr)
		? result.stderr
		: Buffer.from(result.stderr ?? "");
	const stdout = decodedCapture(stdoutBytes, options?.encoding);
	const stderr = decodedCapture(stderrBytes, options?.encoding);
	if (result.error || result.status !== 0) {
		const error =
			result.error ?? new Error(`Command failed with exit ${result.status}`);
		Object.assign(error, {
			status: result.status,
			signal: result.signal,
			stdout,
			stderr,
		});
		throw error;
	}
	return stdout;
}

function decodedCapture(
	bytes: Buffer,
	encoding: NodeSpawnSyncOptions["encoding"],
): Buffer | string {
	return encoding && encoding !== "buffer" ? bytes.toString(encoding) : bytes;
}

function optionsOf(
	argsOrOptions: unknown,
	maybeOptions: unknown,
): NodeSpawnSyncOptions | undefined {
	return (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) as
		| NodeSpawnSyncOptions
		| undefined;
}

function redirectedCommand(
	command: string[],
	stdoutPath: string,
	stderrPath: string,
): string[] {
	return [
		"/bin/sh",
		"-c",
		'stdout_path=$1; stderr_path=$2; shift 2; exec "$@" >"$stdout_path" 2>"$stderr_path"',
		"vwb-test-capture",
		stdoutPath,
		stderrPath,
		...command,
	];
}

function capturedStream(bytes: Promise<Buffer>): ReadableStream<Uint8Array> {
	return new ReadableStream({
		async start(controller) {
			try {
				const value = await bytes;
				if (value.length > 0) controller.enqueue(value);
				controller.close();
			} catch (error) {
				controller.error(error);
			}
		},
	});
}

function createCaptureRoot() {
	const root = mkdtempSync(path.join(os.tmpdir(), "vwb-test-capture-"));
	return {
		stdoutPath: path.join(root, "stdout"),
		stderrPath: path.join(root, "stderr"),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

function readCapture(filePath: string): Buffer {
	try {
		return readFileSync(filePath);
	} catch {
		return Buffer.alloc(0);
	}
}
