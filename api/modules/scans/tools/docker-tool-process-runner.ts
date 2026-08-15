import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readBoundedProcessText } from "./bounded-process-output";
import { cleanupDockerContainer } from "./docker-tool-cleanup";
import {
	assertAllowedDockerInvocation,
	dockerEntrypointFor,
} from "./docker-tool-invocation-policy";
export { registerDockerToolInvocationPolicy } from "./docker-tool-invocation-policy";
import {
	errorMessage,
	getCleanEnv,
	type PipeSubprocess,
} from "./process-runner-shared";
import { emitLifecycleEvent } from "./tool-lifecycle";
import {
	DEFAULT_DOCKER_CPUS,
	DEFAULT_DOCKER_IMAGE,
	DEFAULT_DOCKER_MEMORY,
	DEFAULT_DOCKER_PIDS_LIMIT,
	resolveProcessOutputLimits,
} from "./tool-process-policy";
import type {
	DockerNetworkMode,
	ProcessRunnerOptions,
	ProcessRunnerResult,
	ToolExecutionConfig,
	ToolLifecycleEvent,
} from "./tool-process-types";

const CONTAINER_REPO_PATH = "/workspace/repo";
const CONTAINER_OUT_PATH = "/workspace/out";
const CONTAINER_CACHE_PATH = "/workspace/cache";

export async function runDockerToolProcess(
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
		}) as PipeSubprocess;

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
	} catch (err: unknown) {
		const message = errorMessage(err);
		const error =
			terminationReason === "stdout_limit"
				? `tool_output_limit_exceeded: ${binaryName} Docker stdout exceeded ${outputLimits.stdoutBytes} bytes`
				: terminationReason === "stderr_limit"
					? `tool_stderr_limit_exceeded: ${binaryName} Docker stderr exceeded ${outputLimits.stderrBytes} bytes`
					: terminationReason === "timeout"
						? `${binaryName} Docker execution timed out`
						: `Docker process error: ${message}`;
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
			stderr: stderr || message,
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
		if (timeoutId) clearTimeout(timeoutId);
		if (killAfterTerminationId) clearTimeout(killAfterTerminationId);
		if (proc && (terminationReason || exitCode === null)) {
			await cleanupDockerContainer(dockerBin, containerName, emit);
		}
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
		dockerEntrypointFor(params.binaryName),
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
