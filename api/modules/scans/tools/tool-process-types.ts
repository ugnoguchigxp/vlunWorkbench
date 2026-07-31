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
