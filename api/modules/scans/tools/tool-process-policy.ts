import { parsePositiveInteger } from "./process-runner-shared";
import { RUNTIME_SETTINGS_DEFAULTS } from "../../../config/runtime-settings";
import type {
	ProcessOutputLimits,
	ToolExecutionConfig,
} from "./tool-process-types";

export const DEFAULT_DOCKER_IMAGE = RUNTIME_SETTINGS_DEFAULTS.scanDockerImage;
export const DEFAULT_DOCKER_MEMORY = RUNTIME_SETTINGS_DEFAULTS.dockerMemory;
export const DEFAULT_DOCKER_CPUS = String(RUNTIME_SETTINGS_DEFAULTS.dockerCpus);
export const DEFAULT_DOCKER_PIDS_LIMIT =
	RUNTIME_SETTINGS_DEFAULTS.dockerPidsLimit;
const MIN_DOCKER_MEMORY_BYTES = 512 * 1024 * 1024;
const MAX_DOCKER_MEMORY_BYTES = 8 * 1024 * 1024 * 1024;
const MIN_DOCKER_CPUS = 0.25;
const MAX_DOCKER_CPUS = 4;
const MIN_DOCKER_PIDS = 64;
const MAX_DOCKER_PIDS = 1_024;
export const DEFAULT_PROCESS_OUTPUT_LIMITS: ProcessOutputLimits = {
	stdoutBytes: RUNTIME_SETTINGS_DEFAULTS.scannerStdoutLimitBytes,
	stderrBytes: RUNTIME_SETTINGS_DEFAULTS.scannerStderrLimitBytes,
};
const HARD_PROCESS_OUTPUT_LIMITS: ProcessOutputLimits = {
	stdoutBytes: 256 * 1024 * 1024,
	stderrBytes: 32 * 1024 * 1024,
};

export function resolveProcessOutputLimits(
	limits?: Partial<ProcessOutputLimits>,
): ProcessOutputLimits {
	return {
		stdoutBytes: parsePositiveInteger(
			limits?.stdoutBytes,
			"Scanner stdout limit",
			DEFAULT_PROCESS_OUTPUT_LIMITS.stdoutBytes,
			HARD_PROCESS_OUTPUT_LIMITS.stdoutBytes,
		),
		stderrBytes: parsePositiveInteger(
			limits?.stderrBytes,
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
	const memory = value ?? DEFAULT_DOCKER_MEMORY;
	const bytes = parseDockerMemoryBytes(memory);
	if (bytes < MIN_DOCKER_MEMORY_BYTES || bytes > MAX_DOCKER_MEMORY_BYTES) {
		throw new Error("Docker memory must be between 512 MiB and 8 GiB.");
	}
	return memory;
}

function normalizeDockerCpus(value?: string): string {
	const cpus = value ?? DEFAULT_DOCKER_CPUS;
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
		value,
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
		return {
			runner: "host",
			outputLimits: resolveProcessOutputLimits(execution?.outputLimits),
		};
	}
	const dockerConfig = execution?.docker ?? {};
	const networkMode = dockerConfig.networkMode ?? "none";
	if (networkMode !== "none" && networkMode !== "default") {
		throw new Error(`Invalid Docker network mode: ${networkMode}`);
	}
	if (
		dockerConfig.runtimeNamespaceOwnerId !== undefined &&
		!/^vwb-[0-9a-f-]{36}-owner$/.test(dockerConfig.runtimeNamespaceOwnerId)
	) {
		throw new Error("Invalid runtime namespace owner.");
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
			runtimeNamespaceOwnerId: dockerConfig.runtimeNamespaceOwnerId,
		},
		outputLimits: resolveProcessOutputLimits(execution?.outputLimits),
	};
}
