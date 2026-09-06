import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { getCleanEnv } from "./tool-process-runner";

export async function startMavenCentralNetworkBoundary(params: {
	dockerBin: string;
	resolverImageId: string;
	scanRunId: string;
}): Promise<{ ownerName: string; cleanup: () => Promise<void> }> {
	const boundaryId = crypto.randomUUID();
	const prefix = `vwb-${boundaryId}`;
	const networkName = `${prefix}-maven-internal`;
	const proxyName = `${prefix}-maven-proxy`;
	const ownerName = `${prefix}-owner`;
	let networkCreated = false;
	let proxyCreated = false;
	let ownerCreated = false;
	const label = `com.vuln-workbench.maven-resolution=${params.scanRunId}`;

	const cleanup = async (strict = true) => {
		const results: boolean[] = [];
		if (ownerCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"rm",
				"-f",
				ownerName,
			]);
			results.push(removed);
			if (removed) ownerCreated = false;
		}
		if (proxyCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"rm",
				"-f",
				proxyName,
			]);
			results.push(removed);
			if (removed) proxyCreated = false;
		}
		if (networkCreated) {
			const removed = await runDockerCleanupCommand([
				params.dockerBin,
				"network",
				"rm",
				networkName,
			]);
			results.push(removed);
			if (removed) networkCreated = false;
		}
		if (strict && results.some((result) => !result)) {
			throw new Error("maven_resolver_network_cleanup_failed");
		}
	};

	try {
		await runDockerCommand([
			params.dockerBin,
			"network",
			"create",
			"--internal",
			"--label",
			label,
			networkName,
		]);
		networkCreated = true;
		await runDockerCommand([
			params.dockerBin,
			"create",
			"--name",
			proxyName,
			"--network",
			"default",
			"--user",
			"65532:65532",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--memory",
			"256m",
			"--memory-swap",
			"256m",
			"--cpus",
			"0.5",
			"--pids-limit",
			"64",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=64m,uid=65532,gid=65532",
			"--label",
			label,
			"--entrypoint",
			"java",
			params.resolverImageId,
			"-cp",
			"/opt/vuln-workbench",
			"MavenCentralProxy",
		]);
		proxyCreated = true;
		await runDockerCommand([
			params.dockerBin,
			"network",
			"connect",
			"--alias",
			"maven-central-proxy",
			networkName,
			proxyName,
		]);
		await runDockerCommand([params.dockerBin, "start", proxyName]);
		await runDockerCommand([
			params.dockerBin,
			"create",
			"--name",
			ownerName,
			"--network",
			networkName,
			"--user",
			"65532:65532",
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--memory",
			"64m",
			"--memory-swap",
			"64m",
			"--cpus",
			"0.25",
			"--pids-limit",
			"32",
			"--label",
			label,
			"--entrypoint",
			"/bin/sleep",
			params.resolverImageId,
			"infinity",
		]);
		ownerCreated = true;
		await runDockerCommand([params.dockerBin, "start", ownerName]);

		let healthy = false;
		for (let attempt = 0; attempt < 20 && !healthy; attempt += 1) {
			healthy = await runDockerCommand(
				[
					params.dockerBin,
					"exec",
					proxyName,
					"java",
					"-cp",
					"/opt/vuln-workbench",
					"MavenCentralProxy",
					"health",
				],
				true,
			);
			if (!healthy) {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		if (!healthy) throw new Error("maven_central_proxy_unhealthy");
		return { ownerName, cleanup: async () => await cleanup(true) };
	} catch (error) {
		await cleanup(false);
		throw error;
	}
}

async function runDockerCleanupCommand(args: string[]): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		if (await runDockerCommand(args, true)) return true;
		if (attempt === 0) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	return false;
}

async function runDockerCommand(
	args: string[],
	allowFailure = false,
): Promise<boolean> {
	let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		process = Bun.spawn(args, {
			stdout: "pipe",
			stderr: "pipe",
			env: getCleanEnv(),
		});
	} catch (error) {
		if (allowFailure) return false;
		throw new Error(
			`maven_resolver_docker_boundary_failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		process.kill("SIGKILL");
	}, 30_000);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);
		if (!timedOut && exitCode === 0) return true;
		if (allowFailure) return false;
		throw new Error(
			`maven_resolver_docker_boundary_failed: ${timedOut ? "command timed out" : (stderr || stdout).trim().slice(0, 2_000)}`,
		);
	} catch (error) {
		if (allowFailure) return false;
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

function isPathInside(childPath: string, parentPath: string): boolean {
	const relative = path.relative(
		path.resolve(parentPath),
		path.resolve(childPath),
	);
	return (
		relative === "" ||
		(relative !== ".." &&
			!relative.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relative))
	);
}

export async function assertCacheOutsideRepository(
	cachePath: string,
	repositoryPath: string,
): Promise<void> {
	const [canonicalCache, canonicalRepository] = await Promise.all([
		resolveProspectiveRealpath(cachePath),
		fs.realpath(repositoryPath),
	]);
	if (
		isPathInside(cachePath, repositoryPath) ||
		isPathInside(canonicalCache, canonicalRepository)
	) {
		throw new Error(
			"maven_resolver_cache_inside_target_repository: Maven resolver cache must not be inside the scan target.",
		);
	}
}

async function resolveProspectiveRealpath(
	candidatePath: string,
): Promise<string> {
	let current = path.resolve(candidatePath);
	const missingSegments: string[] = [];
	for (;;) {
		try {
			return path.join(await fs.realpath(current), ...missingSegments);
		} catch (error) {
			if (
				typeof error !== "object" ||
				error === null ||
				!("code" in error) ||
				error.code !== "ENOENT"
			) {
				throw error;
			}
			const parent = path.dirname(current);
			if (parent === current) throw error;
			missingSegments.unshift(path.basename(current));
			current = parent;
		}
	}
}
