import type { AppEnv } from "../../../app/env";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import { RUNTIME_SETTINGS_DEFAULTS } from "../../../config/runtime-settings";

export type ScanExecutionSurface = "web" | "cli" | "security_oracle";

export type ResolvedScanExecutionPolicy = {
	runner: "host" | "docker";
	networkMode: "none";
	dockerImage: string | null;
	source: "default" | "configured" | "request";
	hostExecutionExplicitlyAllowed: boolean;
	surface: ScanExecutionSurface;
	dockerMemory: string;
	dockerCpus: number;
	dockerPidsLimit: number;
	scannerStdoutLimitBytes: number;
	scannerStderrLimitBytes: number;
};

export class ScanExecutionPolicyError extends Error {
	readonly code = "SCAN_EXECUTION_POLICY_DENIED";
}

export function resolveScanExecutionPolicy(params: {
	env: Pick<
		AppEnv,
		| "nodeEnv"
		| "scanExecutionMode"
		| "allowHostScannerExecution"
		| "scanDockerImage"
	> &
		Partial<
			Pick<
				AppEnv,
				| "dockerMemory"
				| "dockerCpus"
				| "dockerPidsLimit"
				| "scannerStdoutLimitBytes"
				| "scannerStderrLimitBytes"
			>
		>;
	surface: ScanExecutionSurface;
	requestedRunner?: "host" | "docker";
}): ResolvedScanExecutionPolicy {
	const configuredRunner = params.env.scanExecutionMode;
	const requestMaySelectRunner = params.surface !== "security_oracle";
	const requestedRunner = requestMaySelectRunner
		? params.requestedRunner
		: undefined;
	const hostExecutionAllowed =
		params.env.allowHostScannerExecution ?? params.env.nodeEnv !== "production";
	const runner =
		configuredRunner ??
		requestedRunner ??
		(params.env.nodeEnv === "production" ? "docker" : "host");
	const source = configuredRunner
		? "configured"
		: requestedRunner
			? "request"
			: "default";

	if (runner === "host" && !hostExecutionAllowed) {
		throw new ScanExecutionPolicyError(
			"Host scanner execution is disabled in Runtime Settings. Select Docker or explicitly allow host execution.",
		);
	}

	return {
		runner,
		networkMode: "none",
		dockerImage:
			runner === "docker" ? (params.env.scanDockerImage ?? null) : null,
		source,
		hostExecutionExplicitlyAllowed: hostExecutionAllowed,
		surface: params.surface,
		dockerMemory:
			params.env.dockerMemory ?? RUNTIME_SETTINGS_DEFAULTS.dockerMemory,
		dockerCpus: params.env.dockerCpus ?? RUNTIME_SETTINGS_DEFAULTS.dockerCpus,
		dockerPidsLimit:
			params.env.dockerPidsLimit ?? RUNTIME_SETTINGS_DEFAULTS.dockerPidsLimit,
		scannerStdoutLimitBytes:
			params.env.scannerStdoutLimitBytes ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStdoutLimitBytes,
		scannerStderrLimitBytes:
			params.env.scannerStderrLimitBytes ??
			RUNTIME_SETTINGS_DEFAULTS.scannerStderrLimitBytes,
	};
}

export function executionConfigFromPolicy(
	policy: ResolvedScanExecutionPolicy,
): ToolExecutionConfig {
	const outputLimits = {
		stdoutBytes: policy.scannerStdoutLimitBytes,
		stderrBytes: policy.scannerStderrLimitBytes,
	};
	if (policy.runner === "host") return { runner: "host", outputLimits };
	return {
		runner: "docker",
		docker: {
			networkMode: policy.networkMode,
			image: policy.dockerImage ?? undefined,
			memory: policy.dockerMemory,
			cpus: String(policy.dockerCpus),
			pidsLimit: policy.dockerPidsLimit,
		},
		outputLimits,
	};
}

export function scanExecutionPolicyMetadata(
	policy: ResolvedScanExecutionPolicy,
): Record<string, unknown> {
	return {
		runner: policy.runner,
		networkMode: policy.networkMode,
		dockerImage: policy.dockerImage,
		source: policy.source,
		hostExecutionExplicitlyAllowed: policy.hostExecutionExplicitlyAllowed,
		surface: policy.surface,
		dockerMemory: policy.dockerMemory,
		dockerCpus: policy.dockerCpus,
		dockerPidsLimit: policy.dockerPidsLimit,
		scannerStdoutLimitBytes: policy.scannerStdoutLimitBytes,
		scannerStderrLimitBytes: policy.scannerStderrLimitBytes,
	};
}
