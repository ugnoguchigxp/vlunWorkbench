import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readBoundedProcessText } from "./bounded-process-output";
import { emitLifecycleEvent } from "./tool-lifecycle";

export type ToolRunnerKind = "host" | "docker";
export type DockerNetworkMode = "none" | "default";

export interface DockerRunnerConfig {
	dockerBin?: string;
	image?: string;
	networkMode?: DockerNetworkMode;
	memory?: string;
	cpus?: string;
	pidsLimit?: number;
	toolCacheDir?: string;
}

export interface ToolExecutionConfig {
	runner: ToolRunnerKind;
	docker?: DockerRunnerConfig;
}

export interface ToolLifecycleEvent {
	level: "debug" | "info" | "warn" | "error";
	eventType: string;
	message: string;
	data?: Record<string, unknown>;
}

export interface ProcessRunnerOptions {
	timeoutSec?: number;
	env?: Record<string, string>;
	execution?: ToolExecutionConfig;
	repoPath?: string;
	outputPath?: string;
	outputLimits?: Partial<ProcessOutputLimits>;
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
}

export interface ProcessOutputLimits {
	stdoutBytes: number;
	stderrBytes: number;
}

export interface ProcessRunnerResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	error?: string;
	executionMetadata?: Record<string, unknown>;
}

const DEFAULT_DOCKER_IMAGE = "vuln-workbench-toolbox:local";
const DEFAULT_DOCKER_MEMORY = "4g";
const DEFAULT_DOCKER_CPUS = "2";
const DEFAULT_DOCKER_PIDS_LIMIT = 512;
const MIN_DOCKER_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_DOCKER_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;
const MIN_DOCKER_CPUS = 0.25;
const MAX_DOCKER_CPUS = 4;
const MIN_DOCKER_PIDS = 64;
const MAX_DOCKER_PIDS = 1_024;
export const DEFAULT_PROCESS_OUTPUT_LIMITS: ProcessOutputLimits = {
	stdoutBytes: 64 * 1024 * 1024,
	stderrBytes: 8 * 1024 * 1024,
};
const HARD_PROCESS_OUTPUT_LIMITS: ProcessOutputLimits = {
	stdoutBytes: 256 * 1024 * 1024,
	stderrBytes: 32 * 1024 * 1024,
};
const CONTAINER_REPO_PATH = "/workspace/repo";
const CONTAINER_OUT_PATH = "/workspace/out";
const CONTAINER_CACHE_PATH = "/workspace/cache";

const DOCKER_TOOL_ALLOWLIST: Record<string, Set<string>> = {
	semgrep: new Set(["--version", "scan"]),
	gitleaks: new Set(["version", "detect"]),
	"osv-scanner": new Set(["--version", "--format", "scan"]),
	trivy: new Set(["--version", "fs", "image"]),
	nuclei: new Set(["--version", "-version", "-u"]),
	st: new Set(["run", "--version"]),
};
const DOCKER_ENTRYPOINTS: Record<string, string> = {};

function parsePositiveInteger(
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

export function resolveProcessOutputLimits(
	limits?: Partial<ProcessOutputLimits>,
): ProcessOutputLimits {
	return {
		stdoutBytes: parsePositiveInteger(
			limits?.stdoutBytes ??
				process.env.VULN_WORKBENCH_SCANNER_STDOUT_LIMIT_BYTES,
			"Scanner stdout limit",
			DEFAULT_PROCESS_OUTPUT_LIMITS.stdoutBytes,
			HARD_PROCESS_OUTPUT_LIMITS.stdoutBytes,
		),
		stderrBytes: parsePositiveInteger(
			limits?.stderrBytes ??
				process.env.VULN_WORKBENCH_SCANNER_STDERR_LIMIT_BYTES,
			"Scanner stderr limit",
			DEFAULT_PROCESS_OUTPUT_LIMITS.stderrBytes,
			HARD_PROCESS_OUTPUT_LIMITS.stderrBytes,
		),
	};
}

function parseDockerMemoryBytes(value: string): number {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)([kmgt])(?:i?b)?$/i);
	if (!match) {
		throw new Error("Docker memory must use a numeric k, m, g, or t suffix.");
	}
	const amount = Number(match[1]);
	const power = { k: 1, m: 2, g: 3, t: 4 }[
		match[2]?.toLowerCase() as "k" | "m" | "g" | "t"
	];
	return amount * 1024 ** power;
}

function normalizeDockerMemory(value?: string): string {
	const memory =
		value ?? process.env.VULN_WORKBENCH_DOCKER_MEMORY ?? DEFAULT_DOCKER_MEMORY;
	const bytes = parseDockerMemoryBytes(memory);
	if (bytes < MIN_DOCKER_MEMORY_BYTES || bytes > MAX_DOCKER_MEMORY_BYTES) {
		throw new Error("Docker memory must be between 512 MiB and 8 GiB.");
	}
	return memory;
}

function normalizeDockerCpus(value?: string): string {
	const cpus =
		value ?? process.env.VULN_WORKBENCH_DOCKER_CPUS ?? DEFAULT_DOCKER_CPUS;
	const parsed = Number(cpus);
	if (
		!Number.isFinite(parsed) ||
		parsed < MIN_DOCKER_CPUS ||
		parsed > MAX_DOCKER_CPUS
	) {
		throw new Error("Docker CPUs must be between 0.25 and 4.");
	}
	return String(parsed);
}

function normalizeDockerPidsLimit(value?: number): number {
	const parsed = parsePositiveInteger(
		value ?? process.env.VULN_WORKBENCH_DOCKER_PIDS_LIMIT,
		"Docker PIDs limit",
		DEFAULT_DOCKER_PIDS_LIMIT,
		MAX_DOCKER_PIDS,
	);
	if (parsed < MIN_DOCKER_PIDS) {
		throw new Error("Docker PIDs limit must be between 64 and 1024.");
	}
	return parsed;
}

export function normalizeToolExecutionConfig(
	execution?: Partial<ToolExecutionConfig>,
): ToolExecutionConfig {
	const runner = execution?.runner ?? "host";
	if (runner !== "host" && runner !== "docker") {
		throw new Error(`Invalid runner: ${runner}`);
	}
	if (runner === "host") {
		return { runner: "host" };
	}
	const dockerConfig = execution?.docker ?? {};
	const networkMode = dockerConfig.networkMode ?? "none";
	if (networkMode !== "none" && networkMode !== "default") {
		throw new Error(`Invalid Docker network mode: ${networkMode}`);
	}
	return {
		runner: "docker",
		docker: {
			dockerBin:
				dockerConfig.dockerBin ??
				process.env.VULN_WORKBENCH_DOCKER_BIN ??
				"docker",
			image: dockerConfig.image ?? DEFAULT_DOCKER_IMAGE,
			networkMode,
			memory: normalizeDockerMemory(dockerConfig.memory),
			cpus: normalizeDockerCpus(dockerConfig.cpus),
			pidsLimit: normalizeDockerPidsLimit(dockerConfig.pidsLimit),
			toolCacheDir: dockerConfig.toolCacheDir,
		},
	};
}

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

export async function runToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions = {},
): Promise<ProcessRunnerResult> {
	const execution = normalizeToolExecutionConfig(options.execution);
	const result =
		execution.runner === "docker"
			? await runDockerToolProcess(binaryName, args, options, execution)
			: await runHostToolProcess(binaryName, args, options);
	if (!result.ok || !options.outputPath) {
		return result;
	}
	const outputLimits = resolveProcessOutputLimits(options.outputLimits);
	const outputStat = await fs.stat(options.outputPath).catch(() => null);
	if (!outputStat || outputStat.size <= outputLimits.stdoutBytes) {
		return result;
	}
	await emitLifecycleEvent(options.onLifecycleEvent, {
		level: "error",
		eventType: "tool.output_file.limit_exceeded",
		message: `${binaryName} structured output exceeded its byte limit.`,
		data: {
			outputBytes: outputStat.size,
			limitBytes: outputLimits.stdoutBytes,
		},
	});
	return {
		...result,
		ok: false,
		error: `tool_output_limit_exceeded: ${binaryName} output file exceeded ${outputLimits.stdoutBytes} bytes`,
		executionMetadata: {
			...result.executionMetadata,
			outputCapture: {
				...((result.executionMetadata?.outputCapture as Record<
					string,
					unknown
				>) ?? {}),
				outputFileBytes: outputStat.size,
				outputFileLimitBytes: outputLimits.stdoutBytes,
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
	let proc: any;
	let timeoutId: any;
	let killAfterTerminationId: any;
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
		});

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
	} catch (err: any) {
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
			stderr: stderr || err.message,
			elapsedMs: Date.now() - startTime,
			error: terminationError ?? `Process error: ${err.message}`,
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

async function runDockerToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions,
	execution: ToolExecutionConfig,
): Promise<ProcessRunnerResult> {
	assertAllowedDockerInvocation(binaryName, args);

	const docker = execution.docker ?? {};
	const dockerBin = docker.dockerBin ?? "docker";
	const image = docker.image ?? DEFAULT_DOCKER_IMAGE;
	const networkMode = docker.networkMode ?? "none";
	const startTime = Date.now();
	const containerName = makeContainerName(binaryName);
	const outputLimits = resolveProcessOutputLimits(options.outputLimits);
	let stdout = "";
	let stderr = "";
	let stdoutBytes = 0;
	let stderrBytes = 0;
	let exitCode: number | null = null;
	let proc: any;
	let timeoutId: any;
	let killAfterTerminationId: any;
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

	const outDir = options.outputPath ? path.dirname(options.outputPath) : null;
	const cacheDir = docker.toolCacheDir
		? path.join(
				path.resolve(docker.toolCacheDir),
				"vuln-workbench-toolbox-cache",
			)
		: undefined;
	if (outDir) {
		await fs.mkdir(outDir, { recursive: true });
		await fs.chmod(outDir, 0o777).catch(() => {});
	}
	if (
		cacheDir &&
		options.repoPath &&
		isPathInside(cacheDir, options.repoPath)
	) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs: Date.now() - startTime,
			error:
				"Docker tool cache directory must not be inside the target repository.",
			executionMetadata: {
				runner: "docker",
			},
		};
	}
	if (cacheDir) {
		await fs.mkdir(cacheDir, { recursive: true });
		await fs.chmod(cacheDir, 0o777).catch(() => {});
	}

	const dockerArgs = buildDockerRunArgs({
		dockerBin,
		image,
		containerName,
		networkMode,
		memory: docker.memory,
		cpus: docker.cpus,
		pidsLimit: docker.pidsLimit,
		toolCacheDir: cacheDir,
		repoPath: options.repoPath,
		outputDir: outDir,
		binaryName,
		toolArgs: rewriteToolArgs(args, {
			repoPath: options.repoPath,
			outputPath: options.outputPath,
			binaryName,
			networkMode,
		}),
	});
	const dockerMetadata = {
		image,
		containerName,
		networkMode,
		mountMode: {
			repo: options.repoPath ? "read-only" : "none",
			output: outDir ? "read-write" : "none",
			cache: cacheDir ? "read-write" : "none",
		},
		resourceLimits: {
			memory: docker.memory,
			memorySwap: docker.memory,
			cpus: docker.cpus,
			pidsLimit: docker.pidsLimit,
		},
	};
	const executionMetadata = {
		runner: "docker",
		docker: dockerMetadata,
	};

	const emit = (event: ToolLifecycleEvent) =>
		emitLifecycleEvent(options.onLifecycleEvent, event);

	try {
		await emit({
			level: "info",
			eventType: "docker.container.create",
			message: `Creating Docker toolbox container ${containerName}.`,
			data: dockerMetadata,
		});

		proc = Bun.spawn(dockerArgs, {
			stdout: "pipe",
			stderr: "pipe",
			env: options.env ?? getCleanEnv(),
		});

		await emit({
			level: "info",
			eventType: "docker.container.start",
			message: `Docker toolbox container ${containerName} started.`,
			data: dockerMetadata,
		});

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

		await emit({
			level: exitCode === 0 ? "info" : "warn",
			eventType: "docker.container.exit",
			message: `Docker toolbox container ${containerName} exited with code ${exitCode}.`,
			data: { ...dockerMetadata, exitCode },
		});
	} catch (err: any) {
		const error =
			terminationReason === "stdout_limit"
				? `tool_output_limit_exceeded: ${binaryName} Docker stdout exceeded ${outputLimits.stdoutBytes} bytes`
				: terminationReason === "stderr_limit"
					? `tool_stderr_limit_exceeded: ${binaryName} Docker stderr exceeded ${outputLimits.stderrBytes} bytes`
					: terminationReason === "timeout"
						? `${binaryName} Docker execution timed out`
						: `Docker process error: ${err.message}`;
		if (terminationReason) {
			await emit({
				level: "error",
				eventType:
					terminationReason === "timeout"
						? "docker.container.timeout"
						: "docker.container.output_limit",
				message:
					terminationReason === "timeout"
						? `Docker toolbox container ${containerName} timed out.`
						: `Docker toolbox container ${containerName} exceeded its output limit.`,
				data: { ...dockerMetadata, terminationReason, outputLimits },
			});
		}
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || err.message,
			elapsedMs: Date.now() - startTime,
			error,
			executionMetadata: {
				...executionMetadata,
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
		if (proc && (terminationReason || exitCode === null))
			await cleanupDockerContainer(dockerBin, containerName, emit);
	}

	const elapsedMs = Date.now() - startTime;

	if (terminationReason) {
		const error =
			terminationReason === "stdout_limit"
				? `tool_output_limit_exceeded: ${binaryName} Docker stdout exceeded ${outputLimits.stdoutBytes} bytes`
				: terminationReason === "stderr_limit"
					? `tool_stderr_limit_exceeded: ${binaryName} Docker stderr exceeded ${outputLimits.stderrBytes} bytes`
					: `${binaryName} Docker execution timed out`;
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			error,
			executionMetadata: {
				...executionMetadata,
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
			...executionMetadata,
			outputCapture: {
				limits: outputLimits,
				stdoutBytes,
				stderrBytes,
				terminationReason: null,
			},
		},
	};
}

function assertAllowedDockerInvocation(
	binaryName: string,
	args: string[],
): void {
	const allowedFirstArgs = DOCKER_TOOL_ALLOWLIST[binaryName];
	if (!allowedFirstArgs) {
		throw new Error(`Docker runner does not allow tool: ${binaryName}`);
	}
	const firstArg = args[0] ?? "";
	if (!allowedFirstArgs.has(firstArg)) {
		throw new Error(
			`Docker runner does not allow ${binaryName} invocation: ${firstArg || "(none)"}`,
		);
	}
}

function rewriteToolArgs(
	args: string[],
	paths: {
		repoPath?: string;
		outputPath?: string;
		binaryName: string;
		networkMode: DockerNetworkMode;
	},
): string[] {
	const rewrittenOutputPath = paths.outputPath
		? `${CONTAINER_OUT_PATH}/${path.basename(paths.outputPath)}`
		: null;
	return args.map((arg) => {
		if (paths.repoPath && path.resolve(arg) === path.resolve(paths.repoPath)) {
			return CONTAINER_REPO_PATH;
		}
		if (paths.repoPath && isPathInside(arg, paths.repoPath)) {
			return `${CONTAINER_REPO_PATH}/${path.relative(paths.repoPath, arg)}`;
		}
		if (
			paths.outputPath &&
			rewrittenOutputPath &&
			path.resolve(arg) === path.resolve(paths.outputPath)
		) {
			return rewrittenOutputPath;
		}
		if (
			paths.networkMode === "default" &&
			(paths.binaryName === "nuclei" || paths.binaryName === "st")
		) {
			try {
				const url = new URL(arg);
				if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
					url.hostname = "host.docker.internal";
					return url.toString().replace(/\/$/, "");
				}
			} catch {
				// Non-URL arguments are returned unchanged.
			}
		}
		return arg;
	});
}

function buildDockerRunArgs(params: {
	dockerBin: string;
	image: string;
	containerName: string;
	networkMode: DockerNetworkMode;
	memory?: string;
	cpus?: string;
	pidsLimit?: number;
	toolCacheDir?: string;
	repoPath?: string;
	outputDir: string | null;
	binaryName: string;
	toolArgs: string[];
}): string[] {
	const args = [
		params.dockerBin,
		"run",
		"--rm",
		"--name",
		params.containerName,
		"--network",
		params.networkMode,
		"--user",
		"65532:65532",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--read-only",
		"--tmpfs",
		"/tmp:rw,nosuid,nodev,size=2g",
		"--memory",
		params.memory ?? DEFAULT_DOCKER_MEMORY,
		"--memory-swap",
		params.memory ?? DEFAULT_DOCKER_MEMORY,
		"--cpus",
		params.cpus ?? DEFAULT_DOCKER_CPUS,
		"--pids-limit",
		String(params.pidsLimit ?? DEFAULT_DOCKER_PIDS_LIMIT),
		"--env",
		"HOME=/tmp",
		"--env",
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"--entrypoint",
		DOCKER_ENTRYPOINTS[params.binaryName] ??
			`/usr/local/bin/${params.binaryName}`,
	];
	if (process.platform === "linux" && params.networkMode === "default") {
		args.push("--add-host", "host.docker.internal:host-gateway");
	}

	if (params.repoPath) {
		args.push(
			"-v",
			`${path.resolve(params.repoPath)}:${CONTAINER_REPO_PATH}:ro`,
		);
	}
	if (params.outputDir) {
		args.push(
			"-v",
			`${path.resolve(params.outputDir)}:${CONTAINER_OUT_PATH}:rw`,
		);
	}
	if (params.toolCacheDir) {
		args.push(
			"-v",
			`${path.resolve(params.toolCacheDir)}:${CONTAINER_CACHE_PATH}:rw`,
		);
	}

	args.push(params.image, ...params.toolArgs);
	return args;
}

function makeContainerName(binaryName: string): string {
	const safeBinary = binaryName.replace(/[^a-zA-Z0-9_.-]/g, "-");
	return `vuln-workbench-${safeBinary}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function isPathInside(childPath: string, parentPath: string): boolean {
	const relative = path.relative(
		path.resolve(parentPath),
		path.resolve(childPath),
	);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

async function cleanupDockerContainer(
	dockerBin: string,
	containerName: string,
	emit: (event: ToolLifecycleEvent) => Promise<void>,
): Promise<void> {
	try {
		const proc = Bun.spawn([dockerBin, "rm", "-f", containerName], {
			stdout: "pipe",
			stderr: "pipe",
			env: getCleanEnv(),
		});
		const [stderrResult, _stdoutResult, exitCode] = await Promise.all([
			readBoundedProcessText(proc.stderr, 64 * 1024),
			readBoundedProcessText(proc.stdout, 64 * 1024),
			proc.exited,
		]);
		if (exitCode !== 0) {
			const stderr = stderrResult.text.trim();
			await emit({
				level: "warn",
				eventType: "docker.container.cleanup_failed",
				message: `Failed to cleanup Docker toolbox container ${containerName}.`,
				data: { containerName, exitCode, stderr },
			});
		}
	} catch (err: any) {
		await emit({
			level: "warn",
			eventType: "docker.container.cleanup_failed",
			message: `Failed to cleanup Docker toolbox container ${containerName}.`,
			data: { containerName, error: err.message },
		});
	}
}
