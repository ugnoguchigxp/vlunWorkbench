import { getCleanEnv } from "../scans/tools/tool-process-runner";
import {
	runBoundedProcess,
	type BoundedProcessTerminationReason,
} from "../processes/bounded-process-runner";
import type { DockerRuntimeBundleRunner } from "./docker-runtime-bundle-lifecycle";

const COMMAND_OUTPUT_LIMIT_BYTES = 1_048_576;
const COMMAND_TIMEOUT_MS = 10 * 60_000;

const terminationDiagnostic = (reason: BoundedProcessTerminationReason) =>
	`runtime_bundle_command_${reason}`;

/** Executes lifecycle-owned Docker argv with a clean environment. */
export function createDockerRuntimeCommandRunner(
	limits: { timeoutMs?: number; outputLimitBytes?: number } = {},
): DockerRuntimeBundleRunner {
	return {
		async run(argv, options) {
			try {
				const result = await runBoundedProcess({
					argv,
					timeoutMs: limits.timeoutMs ?? COMMAND_TIMEOUT_MS,
					outputLimitBytes:
						limits.outputLimitBytes ?? COMMAND_OUTPUT_LIMIT_BYTES,
					env: { ...getCleanEnv(), ...(options?.env ?? {}) },
				});
				return {
					exitCode: result.exitCode,
					stdout: result.stdout,
					stderr: result.terminationReason
						? terminationDiagnostic(result.terminationReason)
						: result.stderr,
					terminationReason: result.terminationReason,
				};
			} catch (error) {
				return {
					exitCode: null,
					stdout: "",
					stderr: error instanceof Error ? error.message : String(error),
					terminationReason: null,
				};
			}
		},
	};
}
