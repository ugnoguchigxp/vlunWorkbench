import path from "node:path";
import { readBoundedProcessText } from "../scans/tools/bounded-process-output";
import {
	normalizeToolExecutionConfig,
	type ProcessOutputLimits,
} from "../scans/tools/tool-process-runner";

type PipeSubprocess = {
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number | null>;
	kill(signal?: string): void;
};

export type DynamicDockerRunResult = {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	elapsedMs: number;
	timedOut: boolean;
	error?: string;
	executionMetadata: Record<string, unknown>;
};

function dockerMemoryBytes(value: string): number {
	const match = value.trim().match(/^(\d+(?:\.\d+)?)([kmgt])(?:i?b)?$/i);
	if (!match) {
		throw new Error("Docker memory must use a numeric k, m, g, or t suffix.");
	}
	const exponent = { k: 1, m: 2, g: 3, t: 4 }[
		match[2]?.toLowerCase() as "k" | "m" | "g" | "t"
	];
	return Number(match[1]) * 1024 ** exponent;
}

function normalizeDynamicDockerLimits(memory?: string, cpus?: string) {
	const docker = normalizeToolExecutionConfig({
		runner: "docker",
		docker: { memory, cpus },
	}).docker;
	if (!docker?.memory || !docker.cpus || !docker.pidsLimit) {
		throw new Error("Dynamic Docker resource limits could not be resolved.");
	}
	return {
		memory: docker.memory,
		cpus: docker.cpus,
		pidsLimit: docker.pidsLimit,
	};
}

export function resolveDynamicDockerLimits(input: {
	profileMemory?: string | null;
	profileCpus?: string | null;
	requestedMemory?: string | null;
	requestedCpus?: string | null;
}): {
	memory: string;
	cpus: string;
	pidsLimit: number;
} {
	const profileLimits = normalizeDynamicDockerLimits(
		input.profileMemory ?? undefined,
		input.profileCpus ?? undefined,
	);
	const requestedLimits = normalizeDynamicDockerLimits(
		input.requestedMemory ?? profileLimits.memory,
		input.requestedCpus ?? profileLimits.cpus,
	);
	if (
		dockerMemoryBytes(requestedLimits.memory) >
		dockerMemoryBytes(profileLimits.memory)
	) {
		throw new Error(
			"Requested dynamic memory must not exceed the saved profile limit.",
		);
	}
	if (Number(requestedLimits.cpus) > Number(profileLimits.cpus)) {
		throw new Error(
			"Requested dynamic CPUs must not exceed the saved profile limit.",
		);
	}
	return requestedLimits;
}

export async function executeDynamicDockerRun(params: {
	dockerBin: string;
	image: string;
	containerName: string;
	networkMode: "none" | "default";
	memory: string;
	cpus: string;
	pidsLimit: number;
	outputLimits: ProcessOutputLimits;
	repoPath: string;
	hostOutDir: string;
	workingDirectory: string;
	command: string[];
	writableWorkdir: boolean;
	expectedArtifacts: string[];
	timeoutSec: number;
}): Promise<DynamicDockerRunResult> {
	const cleanGlobs = params.expectedArtifacts.map((glob) =>
		glob.replace(/\*\*\/\*/g, "*").replace(/\*\*/g, "*"),
	);

	// Static shell wrapper only; profile-controlled values are passed via env.
	const shellScript = `set +e
RUN_ROOT="/workspace/repo"
if [ -d "/workspace/workdir" ]; then
  cp -a /workspace/repo/. /workspace/workdir/
  RUN_ROOT="/workspace/workdir"
fi
cd "$RUN_ROOT/$DYNAMIC_WORKING_DIRECTORY"

"$@"
EXIT_CODE=$?
if [ -n "$DYNAMIC_EXPECTED_ARTIFACTS" ]; then
  printf '%s' "$DYNAMIC_EXPECTED_ARTIFACTS" | tr ':' '\\n' | while IFS= read -r artifact_pattern; do
    [ -z "$artifact_pattern" ] && continue
    find . -path "./$artifact_pattern" -type f -exec sh -c '
      for src do
        rel="\${src#./}"
        dir="$(dirname "$rel")"
        mkdir -p "/workspace/out/$dir"
        cp -- "$src" "/workspace/out/$rel"
      done
    ' sh {} +
  done
fi
exit $EXIT_CODE
`;

	const dockerArgs = [
		params.dockerBin,
		"run",
		"--rm",
		"--name",
		params.containerName,
		"--network",
		params.networkMode,
		"--user",
		"65532:65532",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--read-only",
		"--tmpfs",
		"/tmp:rw,nosuid,nodev,size=256m",
		"--memory",
		params.memory,
		"--memory-swap",
		params.memory,
		"--cpus",
		params.cpus,
		"--pids-limit",
		String(params.pidsLimit),
		"--env",
		"HOME=/tmp",
		"--env",
		"PATH=/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin",
		"--env",
		`DYNAMIC_WORKING_DIRECTORY=${params.workingDirectory}`,
		"--env",
		`DYNAMIC_EXPECTED_ARTIFACTS=${cleanGlobs.join(":")}`,
		"-v",
		`${path.resolve(params.repoPath)}:/workspace/repo:ro`,
		"-v",
		`${path.resolve(params.hostOutDir)}:/workspace/out:rw`,
	];

	if (params.writableWorkdir) {
		dockerArgs.push(
			"--tmpfs",
			"/workspace/workdir:rw,nosuid,nodev,size=512m,uid=65532,gid=65532",
		);
	}
	dockerArgs.push(
		"--entrypoint",
		"/bin/sh",
		params.image,
		"-c",
		shellScript,
		"--",
		...params.command,
	);

	const startTime = Date.now();
	let stdout = "";
	let stderr = "";
	let exitCode: number | null = null;
	let proc: PipeSubprocess | undefined;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let isKilled = false;
	let outputLimitExceeded = false;
	let stdoutBytesRead = 0;
	let stderrBytesRead = 0;

	try {
		proc = Bun.spawn(dockerArgs, {
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		}) as unknown as PipeSubprocess;

		timeoutId = setTimeout(() => {
			isKilled = true;
			proc?.kill("SIGKILL");
		}, params.timeoutSec * 1000);

		const stopForOutputLimit = () => {
			outputLimitExceeded = true;
			proc?.kill("SIGKILL");
		};
		const [stdoutResult, stderrResult, code] = await Promise.all([
			readBoundedProcessText(
				proc.stdout,
				params.outputLimits.stdoutBytes,
				stopForOutputLimit,
			),
			readBoundedProcessText(
				proc.stderr,
				params.outputLimits.stderrBytes,
				stopForOutputLimit,
			),
			proc.exited,
		]);

		exitCode = code;
		stdout = stdoutResult.text;
		stderr = stderrResult.text;
		stdoutBytesRead = stdoutResult.bytesRead;
		stderrBytesRead = stderrResult.bytesRead;
		if (stdoutResult.exceeded || stderrResult.exceeded) {
			const stream = stdoutResult.exceeded ? "stdout" : "stderr";
			return {
				ok: false,
				exitCode,
				stdout,
				stderr,
				elapsedMs: Date.now() - startTime,
				timedOut: false,
				error: `dynamic_output_limit_exceeded:${stream}`,
				executionMetadata: {
					terminationReason: "output_limit_exceeded",
					outputLimits: params.outputLimits,
					stdoutBytesRead,
					stderrBytesRead,
				},
			};
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr: stderr || message,
			elapsedMs: Date.now() - startTime,
			timedOut: isKilled,
			error: isKilled
				? "Docker execution timed out"
				: `Docker process error: ${message}`,
			executionMetadata: {
				terminationReason: isKilled ? "timeout" : "spawn_error",
				outputLimits: params.outputLimits,
				stdoutBytesRead,
				stderrBytesRead,
			},
		};
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
		if (isKilled || outputLimitExceeded) {
			try {
				Bun.spawnSync([params.dockerBin, "rm", "-f", params.containerName]);
			} catch {}
		}
	}

	const elapsedMs = Date.now() - startTime;
	if (isKilled) {
		return {
			ok: false,
			exitCode: null,
			stdout,
			stderr,
			elapsedMs,
			timedOut: true,
			error: "Docker execution timed out",
			executionMetadata: {
				terminationReason: "timeout",
				outputLimits: params.outputLimits,
				stdoutBytesRead,
				stderrBytesRead,
			},
		};
	}

	return {
		ok: true,
		exitCode,
		stdout,
		stderr,
		elapsedMs,
		timedOut: false,
		executionMetadata: {
			terminationReason: "completed",
			outputLimits: params.outputLimits,
			stdoutBytesRead,
			stderrBytesRead,
		},
	};
}
