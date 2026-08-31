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
	/**
	 * Private runtime namespace created by the runtime-bundle lifecycle. This is
	 * intentionally an opaque owner name, never a user-controlled Docker
	 * network name or host-network escape hatch.
	 */
	runtimeNamespaceOwnerId?: string;
}

export interface ToolExecutionConfig {
	runner: ToolRunnerKind;
	docker?: DockerRunnerConfig;
	outputLimits?: Partial<ProcessOutputLimits>;
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
	/** Explicit read-only files (for example a container image tarball). */
	inputPaths?: string[];
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
