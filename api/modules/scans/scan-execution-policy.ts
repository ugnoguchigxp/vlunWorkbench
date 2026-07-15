import type { AppEnv } from "../../app/env";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";

export type ScanExecutionSurface = "web" | "cli" | "security_oracle";

export type ResolvedScanExecutionPolicy = {
	runner: "host" | "docker";
	networkMode: "none";
	dockerImage: string | null;
	source: "default" | "environment" | "request";
	hostExecutionExplicitlyAllowed: boolean;
	surface: ScanExecutionSurface;
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
		? "environment"
		: requestedRunner
			? "request"
			: "default";

	if (runner === "host" && !hostExecutionAllowed) {
		throw new ScanExecutionPolicyError(
			"Host scanner execution is disabled. Set SCAN_EXECUTION_MODE=docker or explicitly allow host execution with ALLOW_HOST_SCANNER_EXECUTION=true.",
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
	};
}

export function executionConfigFromPolicy(
	policy: ResolvedScanExecutionPolicy,
): ToolExecutionConfig {
	if (policy.runner === "host") return { runner: "host" };
	return {
		runner: "docker",
		docker: {
			networkMode: policy.networkMode,
			image: policy.dockerImage ?? undefined,
		},
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
	};
}
