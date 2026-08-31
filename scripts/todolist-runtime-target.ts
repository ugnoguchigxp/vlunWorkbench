import { setTimeout as delay } from "node:timers/promises";

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

export type TodolistRuntimeTarget = {
	containerName: string;
	origin: string;
	stop: () => Promise<void>;
};

async function runDocker(args: string[]): Promise<CommandResult> {
	const child = Bun.spawn(["docker", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function portFromDockerOutput(output: string): number | null {
	const match = output.match(/(?:127\.0\.0\.1|0\.0\.0\.0):(\d+)\s*$/m);
	if (!match?.[1]) return null;
	const port = Number(match[1]);
	return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
}

async function waitForHealth(origin: string): Promise<void> {
	const deadline = Date.now() + 60_000;
	let lastError = "health endpoint did not respond";
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${origin}/api/health`, {
				signal: AbortSignal.timeout(2_000),
			});
			const body: unknown = await response.json();
			if (
				response.ok &&
				body &&
				typeof body === "object" &&
				(body as Record<string, unknown>).status === "ok" &&
				(body as Record<string, unknown>).service === "hono-standard"
			) {
				return;
			}
			lastError = `unexpected health response: ${response.status}`;
		} catch (error) {
			lastError = String(error);
		}
		await delay(250);
	}
	throw new Error(`todolist_runtime_target_not_ready:${lastError}`);
}

/**
 * Starts the fixed todolist image as an isolated, loopback-only DAST target.
 * This intentionally avoids the production path that executes an untrusted
 * project checkout on the host; scanners only see the published local origin.
 */
export async function startTodolistRuntimeTarget(
	image: string,
): Promise<TodolistRuntimeTarget> {
	const containerName = `vwb-todolist-target-${crypto.randomUUID().slice(0, 12)}`;
	const start = await runDocker([
		"run",
		"-d",
		"--rm",
		"--name",
		containerName,
		"--read-only",
		"--tmpfs",
		"/data:rw,nosuid,nodev,size=128m,mode=1777",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--pids-limit",
		"256",
		"--memory",
		"512m",
		"--env",
		`JWT_SECRET=${crypto.randomUUID()}${crypto.randomUUID()}`,
		"-p",
		"127.0.0.1::5173",
		image,
	]);
	if (start.exitCode !== 0) {
		throw new Error(`todolist_runtime_target_start_failed:${start.stderr}`);
	}
	const stop = async () => {
		await runDocker(["rm", "-f", containerName]).catch(() => undefined);
	};
	try {
		const portProbe = await runDocker(["port", containerName, "5173/tcp"]);
		const port =
			portProbe.exitCode === 0 ? portFromDockerOutput(portProbe.stdout) : null;
		if (!port) {
			throw new Error(
				`todolist_runtime_target_port_missing:${portProbe.stderr || portProbe.stdout}`,
			);
		}
		const origin = `http://127.0.0.1:${port}`;
		await waitForHealth(origin);
		return { containerName, origin, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}
