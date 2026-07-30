import crypto from "node:crypto";
import type { ActiveResetStrategy } from "../../../shared/schemas/active-assessment.schema";
import type { DastFetch } from "../dast/http-runner";
import type { ActiveResetExecutor } from "./zap-active-runner";

type ContainerFixtureStrategy = Extract<
	ActiveResetStrategy,
	{ kind: "container_recreate" }
>;

type SpawnResult = {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};

const FIXTURES = {
	"juice-shop-20.1.1": {
		image:
			"docker.io/bkimminich/juice-shop@sha256:cd58d79c5cb4d82f22fbaf616f9ff43bbd04ba630cd6b448a9ed99cf652fcebf",
		containerName: "vuln-workbench-fixture-juice-shop-20-1-1",
		port: 3000,
		healthPath: "/",
	},
} as const;
const activeFixtureIds = new Set<string>();

export function listContainerFixtures() {
	return Object.entries(FIXTURES).map(([fixtureId, fixture]) => ({
		fixtureId,
		image: fixture.image,
		port: fixture.port,
		expectedBaselineHash: fixtureBaselineHash(fixtureId),
	}));
}

export function createContainerFixtureResetExecutor(params: {
	strategy: ContainerFixtureStrategy;
	targetOrigin: string;
	dockerBin?: string;
	fetchImpl?: DastFetch;
	spawn?: (args: string[], timeoutSec: number) => Promise<SpawnResult>;
}): ActiveResetExecutor {
	const fixture = FIXTURES[params.strategy.fixtureId as keyof typeof FIXTURES];
	if (!fixture) throw new Error("zap_active_container_fixture_not_registered");
	const baselineHash = fixtureBaselineHash(params.strategy.fixtureId);
	if (params.strategy.expectedBaselineHash !== baselineHash)
		throw new Error("zap_active_container_fixture_baseline_mismatch");
	const target = new URL(params.targetOrigin);
	if (
		!["127.0.0.1", "[::1]", "localhost"].includes(target.hostname) ||
		Number(target.port || defaultPort(target.protocol)) !== fixture.port
	)
		throw new Error("zap_active_container_fixture_target_mismatch");
	const spawn = params.spawn ?? spawnBounded;
	let ownsFixtureClaim = false;
	const acquireFixture = () => {
		if (ownsFixtureClaim || activeFixtureIds.has(params.strategy.fixtureId))
			throw new Error("zap_active_container_fixture_busy");
		activeFixtureIds.add(params.strategy.fixtureId);
		ownsFixtureClaim = true;
	};
	const releaseFixture = () => {
		if (!ownsFixtureClaim) return;
		activeFixtureIds.delete(params.strategy.fixtureId);
		ownsFixtureClaim = false;
	};
	const recreate = async () => {
		const removed = await spawn(
			[params.dockerBin ?? "docker", "rm", "-f", fixture.containerName],
			30,
		);
		if (
			removed.timedOut ||
			(removed.exitCode !== 0 &&
				!removed.stderr.toLowerCase().includes("no such container"))
		)
			throw new Error("zap_active_container_fixture_cleanup_failed");
		const started = await spawn(
			[
				params.dockerBin ?? "docker",
				"run",
				"-d",
				"--name",
				fixture.containerName,
				"--pull",
				"never",
				"--network",
				"host",
				"--memory",
				"1g",
				"--memory-swap",
				"1g",
				"--cpus",
				"1",
				"--pids-limit",
				"256",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				fixture.image,
			],
			60,
		);
		if (started.timedOut || started.exitCode !== 0)
			throw new Error("zap_active_container_fixture_start_failed");
		await waitUntilHealthy(
			new URL(fixture.healthPath, target).toString(),
			params.fetchImpl ?? fetch,
		);
		return baselineHash;
	};
	return {
		prepare: async () => {
			acquireFixture();
			try {
				return { baselineHash: await recreate() };
			} catch (error) {
				releaseFixture();
				throw error;
			}
		},
		reset: async () => {
			if (!ownsFixtureClaim)
				return {
					ok: false,
					baselineHash: null,
					errorCode: "zap_active_container_fixture_not_prepared",
				};
			try {
				return { ok: true, baselineHash: await recreate() };
			} catch (error) {
				return {
					ok: false,
					baselineHash: null,
					errorCode:
						error instanceof Error
							? error.message
							: "zap_active_container_fixture_reset_failed",
				};
			} finally {
				releaseFixture();
			}
		},
	};
}

function fixtureBaselineHash(fixtureId: string): string {
	const fixture = FIXTURES[fixtureId as keyof typeof FIXTURES];
	if (!fixture) throw new Error("zap_active_container_fixture_not_registered");
	return `sha256:${crypto
		.createHash("sha256")
		.update(
			JSON.stringify({
				fixtureId,
				image: fixture.image,
				port: fixture.port,
			}),
		)
		.digest("hex")}`;
}

async function waitUntilHealthy(
	url: string,
	fetchImpl: DastFetch,
): Promise<void> {
	const deadline = Date.now() + 30_000;
	let lastError = "unreachable";
	while (Date.now() < deadline) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 2_000);
		try {
			const response = await fetchImpl(url, {
				method: "GET",
				redirect: "manual",
				signal: controller.signal,
			});
			if (response.status >= 200 && response.status < 400) return;
			lastError = `status_${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : "unreachable";
		} finally {
			clearTimeout(timer);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`zap_active_container_fixture_health_failed:${lastError}`);
}

function defaultPort(protocol: string): number {
	return protocol === "https:" ? 443 : 80;
}

async function spawnBounded(
	args: string[],
	timeoutSec: number,
): Promise<SpawnResult> {
	const child = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const stdout = child.stdout
		? new Response(child.stdout).text()
		: Promise.resolve("");
	const stderr = child.stderr
		? new Response(child.stderr).text()
		: Promise.resolve("");
	let timer: ReturnType<typeof setTimeout> | undefined;
	const result = await Promise.race([
		child.exited.then((exitCode) => ({ exitCode, timedOut: false })),
		new Promise<{ exitCode: null; timedOut: true }>((resolve) => {
			timer = setTimeout(
				() => resolve({ exitCode: null, timedOut: true }),
				timeoutSec * 1000,
			);
		}),
	]);
	if (timer) clearTimeout(timer);
	if (result.timedOut) child.kill("SIGKILL");
	return {
		...result,
		stdout: await stdout,
		stderr: await stderr,
	};
}
