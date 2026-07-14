import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type ToolRunnerKind = "host" | "docker";
export type DockerNetworkMode = "none" | "default";

export interface DockerRunnerConfig {
	dockerBin?: string;
	image?: string;
	networkMode?: DockerNetworkMode;
	memory?: string;
	cpus?: string;
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
	onLifecycleEvent?: (event: ToolLifecycleEvent) => Promise<void> | void;
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
const CONTAINER_REPO_PATH = "/workspace/repo";
const CONTAINER_OUT_PATH = "/workspace/out";
const CONTAINER_CACHE_PATH = "/workspace/cache";

const DOCKER_TOOL_ALLOWLIST: Record<string, Set<string>> = {
	semgrep: new Set(["--version", "scan"]),
	gitleaks: new Set(["version", "detect"]),
	"osv-scanner": new Set(["--version", "--format"]),
	trivy: new Set(["--version", "fs", "image"]),
	nuclei: new Set(["--version", "-version", "-u"]),
	"zap-baseline.py": new Set(["zap-baseline.py", "-h"]),
	st: new Set(["run", "--version"]),
};
const DOCKER_ENTRYPOINTS: Record<string, string> = {
	"zap-baseline.py": "/zap/zap-baseline.py",
};

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
			memory: dockerConfig.memory,
			cpus: dockerConfig.cpus,
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
	return result.stdout.trim();
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
	if (execution.runner === "docker") {
		return await runDockerToolProcess(binaryName, args, options, execution);
	}
	return await runHostToolProcess(binaryName, args, options);
}

async function runHostToolProcess(
	binaryName: string,
	args: string[],
	options: ProcessRunnerOptions,
): Promise<ProcessRunnerResult> {
	const startTime = Date.now();
	const cleanEnv = options.env ?? getCleanEnv();
	let exitCode: number | null = null;
	let stdout = "";
	let stderr = "";
	let proc: any;
	let timeoutId: any;
	let killAfterTimeoutId: any;
	let isKilled = false;

	try {
		proc = Bun.spawn([binaryName, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			env: cleanEnv,
		});

		const timeoutSec = options.timeoutSec ?? 300;
		timeoutId = setTimeout(() => {
			isKilled = true;
			proc.kill("SIGTERM");
			killAfterTimeoutId = setTimeout(() => {
				proc.kill("SIGKILL");
			}, 2_000);
		}, timeoutSec * 1000);

		const [stdoutBuf, stderrBuf, code] = await Promise.all([
			new Response(proc.stdout).arrayBuffer(),
			new Response(proc.stderr).arrayBuffer(),
			proc.exited,
		]);

		exitCode = code;
		stdout = new TextDecoder().decode(stdoutBuf);
		stderr = new TextDecoder().decode(stderrBuf);
	} catch (err: any) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || err.message,
			elapsedMs: Date.now() - startTime,
			error: isKilled
				? `${binaryName} execution timed out`
				: `Process error: ${err.message}`,
		};
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (killAfterTimeoutId) {
			clearTimeout(killAfterTimeoutId);
		}
	}

	const elapsedMs = Date.now() - startTime;

	if (isKilled) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			error: `${binaryName} execution timed out`,
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
	let stdout = "";
	let stderr = "";
	let exitCode: number | null = null;
	let proc: any;
	let timeoutId: any;
	let killAfterTimeoutId: any;
	let isKilled = false;

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
		toolCacheDir: cacheDir,
		repoPath: options.repoPath,
		outputDir: outDir,
		binaryName,
		toolArgs: rewriteToolArgs(
			binaryName === "zap-baseline.py" && args[0] === "zap-baseline.py"
				? args.slice(1)
				: args,
			{
				repoPath: options.repoPath,
				outputPath: options.outputPath,
			},
		),
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
			memory: docker.memory ?? null,
			cpus: docker.cpus ?? null,
		},
	};
	const executionMetadata = {
		runner: "docker",
		docker: dockerMetadata,
	};

	const emit = async (event: ToolLifecycleEvent) => {
		await options.onLifecycleEvent?.(event);
	};

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
			isKilled = true;
			proc.kill("SIGTERM");
			killAfterTimeoutId = setTimeout(() => {
				proc.kill("SIGKILL");
			}, 2_000);
		}, timeoutSec * 1000);

		const [stdoutBuf, stderrBuf, code] = await Promise.all([
			new Response(proc.stdout).arrayBuffer(),
			new Response(proc.stderr).arrayBuffer(),
			proc.exited,
		]);

		exitCode = code;
		stdout = new TextDecoder().decode(stdoutBuf);
		stderr = new TextDecoder().decode(stderrBuf);

		await emit({
			level: exitCode === 0 ? "info" : "warn",
			eventType: "docker.container.exit",
			message: `Docker toolbox container ${containerName} exited with code ${exitCode}.`,
			data: { ...dockerMetadata, exitCode },
		});
	} catch (err: any) {
		const error = isKilled
			? `${binaryName} Docker execution timed out`
			: `Docker process error: ${err.message}`;
		if (isKilled) {
			await emit({
				level: "error",
				eventType: "docker.container.timeout",
				message: `Docker toolbox container ${containerName} timed out.`,
				data: dockerMetadata,
			});
		}
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || err.message,
			elapsedMs: Date.now() - startTime,
			error,
			executionMetadata,
		};
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (killAfterTimeoutId) {
			clearTimeout(killAfterTimeoutId);
		}
		if (isKilled) {
			await cleanupDockerContainer(dockerBin, containerName, emit);
		}
	}

	const elapsedMs = Date.now() - startTime;

	if (isKilled) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			error: `${binaryName} Docker execution timed out`,
			executionMetadata,
		};
	}

	return {
		ok: true,
		exitCode,
		stdout,
		stderr,
		elapsedMs,
		executionMetadata,
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
	paths: { repoPath?: string; outputPath?: string },
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
		"/tmp:rw,nosuid,nodev,size=256m",
		"--env",
		"HOME=/tmp",
		"--env",
		"PATH=/usr/local/bin:/usr/bin:/bin",
		"--entrypoint",
		DOCKER_ENTRYPOINTS[params.binaryName] ??
			`/usr/local/bin/${params.binaryName}`,
	];

	if (params.memory) {
		args.push("--memory", params.memory);
	}
	if (params.cpus) {
		args.push("--cpus", params.cpus);
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
		(!relative.startsWith("..") && !path.isAbsolute(relative))
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
		const [stderrBuf, _stdoutBuf, exitCode] = await Promise.all([
			new Response(proc.stderr).arrayBuffer(),
			new Response(proc.stdout).arrayBuffer(),
			proc.exited,
		]);
		if (exitCode !== 0) {
			const stderr = new TextDecoder().decode(stderrBuf).trim();
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
