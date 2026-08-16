import { runBoundedProcess } from "../../processes/bounded-process-runner";
import { errorMessage, getCleanEnv } from "./process-runner-shared";
import type { ToolLifecycleEvent } from "./tool-process-types";

export async function cleanupDockerContainer(
	dockerBin: string,
	containerName: string,
	emit: (event: ToolLifecycleEvent) => Promise<void>,
): Promise<void> {
	try {
		const result = await runBoundedProcess({
			argv: [dockerBin, "rm", "-f", containerName],
			timeoutMs: 30_000,
			outputLimitBytes: 64 * 1024,
			env: getCleanEnv(),
		});
		if (result.exitCode !== 0) {
			const stderr = result.stderr.trim();
			await emit({
				level: "warn",
				eventType: "docker.container.cleanup_failed",
				message: `Failed to cleanup Docker toolbox container ${containerName}.`,
				data: {
					containerName,
					exitCode: result.exitCode,
					stderr,
					terminationReason: result.terminationReason,
				},
			});
		}
	} catch (err: unknown) {
		await emit({
			level: "warn",
			eventType: "docker.container.cleanup_failed",
			message: `Failed to cleanup Docker toolbox container ${containerName}.`,
			data: { containerName, error: errorMessage(err) },
		});
	}
}
