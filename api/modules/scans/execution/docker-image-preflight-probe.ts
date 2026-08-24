import { randomUUID } from "node:crypto";
import type { DockerImageProbe } from "./scan-preflight-binding";

const DOCKER_ENGINE_WAKE_TIMEOUT_SEC = 20;
const DOCKER_ENGINE_CLEANUP_TIMEOUT_SEC = 10;
const DOCKER_WAKE_CONTAINER_PREFIX = "vwb-preflight-wake-";

export type DockerProbeCommandResult = {
	ok?: boolean;
	exitCode: number | null;
	stdout?: string;
	stderr?: string;
	error?: string;
};

export type DockerProbeCommandRunner = (
	binary: string,
	args: string[],
	timeoutSec?: number,
) => Promise<DockerProbeCommandResult>;

type DockerImageProbeOptions = {
	containerNameFactory?: () => string;
};

function commandSucceeded(result: DockerProbeCommandResult): boolean {
	return result.ok !== false && result.exitCode === 0;
}

function failureText(result: DockerProbeCommandResult): string {
	return [result.stderr, result.stdout, result.error]
		.filter((value): value is string => Boolean(value))
		.join("\n");
}

function imageMissing(value: string): boolean {
	return /\bno such image\b|image .+ not found|unable to find image .+ locally|pull access denied/i.test(
		value,
	);
}

function containerMissing(value: string): boolean {
	return /\bno such container\b/i.test(value);
}

function daemonUnavailable(value: string): boolean {
	return /cannot connect to (?:the )?docker daemon|error during connect|is the docker daemon running|connection refused|permission denied while trying to connect|docker desktop is unable to start|context deadline exceeded|request canceled|unexpected eof/i.test(
		value,
	);
}

const inspectArgs = (image: string) => [
	"image",
	"inspect",
	"--format",
	"{{json .RepoDigests}}\t{{.Id}}\t{{.Os}}/{{.Architecture}}",
	"--",
	image,
];

function wakeCreateArgs(image: string, containerName: string): string[] {
	return [
		"create",
		"--name",
		containerName,
		"--pull=never",
		"--network",
		"none",
		"--user",
		"65532:65532",
		"--cap-drop",
		"ALL",
		"--security-opt",
		"no-new-privileges",
		"--read-only",
		"--memory",
		"128m",
		"--memory-swap",
		"128m",
		"--cpus",
		"0.25",
		"--pids-limit",
		"32",
		"--entrypoint",
		"/bin/true",
		"--",
		image,
	];
}

/**
 * Inspect is normally side-effect free. Docker Desktop Resource Saver is a
 * special case: its backend can falsely report a local image as missing while
 * the Linux VM is stopped. A constrained container is created but never
 * started, then removed before one authoritative retry.
 */
export async function inspectDockerImageWithRecovery(
	dockerBin: string,
	image: string,
	runner: DockerProbeCommandRunner,
	options: DockerImageProbeOptions = {},
): Promise<{
	available: boolean;
	result: DockerProbeCommandResult;
	reasonCode: string | null;
}> {
	let result = await runner(dockerBin, inspectArgs(image));
	if (commandSucceeded(result)) {
		return { available: true, result, reasonCode: null };
	}
	const initialFailure = failureText(result);
	if (!imageMissing(initialFailure)) {
		return {
			available: false,
			result,
			reasonCode:
				daemonUnavailable(initialFailure) || result.ok === false
					? "docker_daemon_unavailable"
					: "docker_image_unavailable",
		};
	}

	const containerName =
		options.containerNameFactory?.() ??
		`${DOCKER_WAKE_CONTAINER_PREFIX}${randomUUID()}`;
	const wakeResult = await runner(
		dockerBin,
		wakeCreateArgs(image, containerName),
		DOCKER_ENGINE_WAKE_TIMEOUT_SEC,
	);
	// Always attempt cleanup. A timed-out or otherwise failed `docker create`
	// may have reached the daemon even when the client did not receive an ID.
	const cleanupResult = await runner(
		dockerBin,
		["container", "rm", "--force", "--", containerName],
		DOCKER_ENGINE_CLEANUP_TIMEOUT_SEC,
	);
	const cleanupReady =
		commandSucceeded(cleanupResult) ||
		containerMissing(failureText(cleanupResult));

	result = await runner(dockerBin, inspectArgs(image));
	const available = commandSucceeded(result) && cleanupReady;
	if (available) return { available, result, reasonCode: null };

	const combinedFailure = `${failureText(result)}\n${failureText(wakeResult)}`;
	const engineUnavailable =
		!cleanupReady ||
		daemonUnavailable(combinedFailure) ||
		((result.ok === false || wakeResult.ok === false) &&
			!imageMissing(combinedFailure));
	return {
		available: false,
		result,
		reasonCode: engineUnavailable
			? "docker_daemon_unavailable"
			: "docker_image_unavailable",
	};
}

export async function probeDockerImageWithRecovery(
	dockerBin: string,
	image: string,
	runner: DockerProbeCommandRunner,
	options: DockerImageProbeOptions = {},
): Promise<DockerImageProbe> {
	const inspection = await inspectDockerImageWithRecovery(
		dockerBin,
		image,
		runner,
		options,
	);
	const [rawRepoDigests, rawImageId, rawPlatform] = (
		inspection.result.stdout ?? ""
	)
		.trim()
		.split("\t", 3);
	let repoDigests: string[] = [];
	try {
		const parsed = rawRepoDigests ? JSON.parse(rawRepoDigests) : null;
		if (Array.isArray(parsed)) {
			repoDigests = parsed.filter(
				(value): value is string => typeof value === "string",
			);
		}
	} catch {
		// The image exists but its inspect payload cannot establish a digest.
	}
	const digest = repoDigests
		.map((value) => value.match(/@(sha256:[a-f0-9]{64})$/)?.[1] ?? null)
		.find((value): value is string => value !== null);
	return {
		ready: inspection.available && Boolean(rawPlatform),
		digest: digest && /^sha256:[a-f0-9]{64}$/.test(digest) ? digest : null,
		repoDigests,
		imageId: /^sha256:[a-f0-9]{64}$/.test(rawImageId ?? "") ? rawImageId : null,
		platform: rawPlatform || null,
		reasonCode: !inspection.available
			? inspection.reasonCode
			: rawPlatform
				? null
				: "docker_image_platform_missing",
	};
}
