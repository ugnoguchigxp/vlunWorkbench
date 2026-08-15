import { readBoundedProcessText } from "./bounded-process-output";
import { errorMessage, getCleanEnv } from "./process-runner-shared";
import type { ToolLifecycleEvent } from "./tool-process-types";

export async function cleanupDockerContainer(
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
		const [stderrResult, _stdoutResult, exitCode] = await Promise.all([
			readBoundedProcessText(proc.stderr, 64 * 1024),
			readBoundedProcessText(proc.stdout, 64 * 1024),
			proc.exited,
		]);
		if (exitCode !== 0) {
			const stderr = stderrResult.text.trim();
			await emit({
				level: "warn",
				eventType: "docker.container.cleanup_failed",
				message: `Failed to cleanup Docker toolbox container ${containerName}.`,
				data: { containerName, exitCode, stderr },
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
