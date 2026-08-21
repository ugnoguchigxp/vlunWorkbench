import { getCleanEnv } from "../scans/tools/tool-process-runner";
import { readBoundedProcessText } from "../scans/tools/bounded-process-output";
import type { DockerRuntimeBundleRunner } from "./docker-runtime-bundle-lifecycle";

const COMMAND_OUTPUT_LIMIT_BYTES = 1_048_576;

/** Executes lifecycle-owned Docker argv with a clean environment. */
export function createDockerRuntimeCommandRunner(): DockerRuntimeBundleRunner {
	return {
		async run(argv, options) {
			try {
				const proc = Bun.spawn(argv, {
					stdout: "pipe",
					stderr: "pipe",
					env: { ...getCleanEnv(), ...(options?.env ?? {}) },
				});
				let exceeded = false;
				const stopForOutputLimit = () => {
					exceeded = true;
					proc.kill();
				};
				const [exitCode, stdout, stderr] = await Promise.all([
					proc.exited,
					readBoundedProcessText(
						proc.stdout,
						COMMAND_OUTPUT_LIMIT_BYTES,
						stopForOutputLimit,
					),
					readBoundedProcessText(
						proc.stderr,
						COMMAND_OUTPUT_LIMIT_BYTES,
						stopForOutputLimit,
					),
				]);
				return {
					exitCode: exceeded ? null : exitCode,
					stdout: stdout.text,
					stderr: exceeded
						? `${stderr.text}\nruntime_bundle_command_output_limit_exceeded`
						: stderr.text,
				};
			} catch (error) {
				return {
					exitCode: null,
					stdout: "",
					stderr: error instanceof Error ? error.message : String(error),
				};
			}
		},
	};
}
