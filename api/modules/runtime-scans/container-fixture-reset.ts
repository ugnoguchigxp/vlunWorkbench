import crypto from "node:crypto";
import type { ActiveResetStrategy } from "../../../shared/schemas/active-assessment.schema";
import type { DastFetch } from "../dast/http-runner";
import { runBoundedProcess } from "../processes/bounded-process-runner";
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

type ExecFetchResult = {
	status: number;
	statusText: string;
	headers: Record<string, string>;
	body: string;
};

export type ContainerFixtureResetExecutor = ActiveResetExecutor & {
	teardown: () => Promise<{ ok: boolean; errorCode?: string }>;
};

const CONTAINER_LOOPBACK_FETCH_SCRIPT = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const response = await fetch(request.url, {
  method: request.method,
  headers: request.headers,
  body: request.body,
  redirect: request.redirect,
  signal: AbortSignal.timeout(request.timeoutMs)
});
const body = Buffer.from(await response.arrayBuffer());
if (body.length > 1048576) throw new Error("response_too_large");
process.stdout.write(JSON.stringify({
  status: response.status,
  statusText: response.statusText,
  headers: Object.fromEntries(response.headers.entries()),
  body: body.toString("base64")
}));
`;

const FIXTURES = {
	"juice-shop-20.1.1": {
		image:
			"docker.io/bkimminich/juice-shop@sha256:cd58d79c5cb4d82f22fbaf616f9ff43bbd04ba630cd6b448a9ed99cf652fcebf",
		containerName: "vuln-workbench-fixture-juice-shop-20-1-1",
		networkName: "vuln-workbench-fixture-internal",
		nodeBin: "/nodejs/bin/node",
		port: 3000,
		healthPath: "/",
	},
} as const;
const activeFixtureIds = new Set<string>();
const FIXTURE_PROCESS_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;

export function listContainerFixtures() {
	return Object.entries(FIXTURES).map(([fixtureId, fixture]) => ({
		fixtureId,
		image: fixture.image,
		port: fixture.port,
		expectedBaselineHash: fixtureBaselineHash(fixtureId),
	}));
}

/**
 * Performs a bounded HTTP request from inside the isolated fixture container.
 * The fixture stays on an internal Docker network with no host or internet route.
 */
export function createContainerFixtureLoopbackFetch(params: {
	fixtureId: string;
	dockerBin?: string;
}): DastFetch {
	const fixture = FIXTURES[params.fixtureId as keyof typeof FIXTURES];
	if (!fixture) throw new Error("zap_active_container_fixture_not_registered");
	return async (input, init = {}) => {
		const inputRequest = input instanceof Request ? input : null;
		const inputUrl = new URL(
			input instanceof Request
				? input.url
				: input instanceof URL
					? input.href
					: input,
		);
		if (
			inputUrl.protocol !== "http:" ||
			!["127.0.0.1", "localhost", "[::1]"].includes(inputUrl.hostname) ||
			Number(inputUrl.port || 80) !== fixture.port
		)
			throw new Error("zap_active_container_fixture_loopback_target_mismatch");
		const method = (init.method ?? inputRequest?.method ?? "GET").toUpperCase();
		const headers = new Headers(inputRequest?.headers);
		for (const [name, value] of new Headers(init.headers))
			headers.set(name, value);
		let body: string | null = null;
		if (typeof init.body === "string") body = init.body;
		else if (init.body !== undefined && init.body !== null)
			throw new Error("zap_active_container_fixture_loopback_body_unsupported");
		else if (inputRequest && !["GET", "HEAD"].includes(method))
			body = await inputRequest.clone().text();
		const payload = JSON.stringify({
			url: `http://127.0.0.1:${fixture.port}${inputUrl.pathname}${inputUrl.search}`,
			method,
			headers: Object.fromEntries(headers.entries()),
			body,
			redirect: init.redirect ?? inputRequest?.redirect ?? "manual",
			timeoutMs: 12_000,
		});
		const result = await spawnWithStdin(
			[
				params.dockerBin ?? "docker",
				"exec",
				"-i",
				fixture.containerName,
				fixture.nodeBin,
				"-e",
				CONTAINER_LOOPBACK_FETCH_SCRIPT,
			],
			payload,
			15,
			init.signal,
		);
		if (result.timedOut)
			throw new Error("zap_active_container_fixture_loopback_timeout");
		if (result.exitCode !== 0)
			throw new Error("zap_active_container_fixture_loopback_request_failed");
		let parsed: ExecFetchResult;
		try {
			parsed = JSON.parse(result.stdout) as ExecFetchResult;
		} catch {
			throw new Error("zap_active_container_fixture_loopback_response_invalid");
		}
		return new Response(Buffer.from(parsed.body, "base64"), {
			status: parsed.status,
			statusText: parsed.statusText,
			headers: parsed.headers,
		});
	};
}

export function createContainerFixtureResetExecutor(params: {
	strategy: ContainerFixtureStrategy;
	targetOrigin: string;
	dockerBin?: string;
	fetchImpl?: DastFetch;
	spawn?: (args: string[], timeoutSec: number) => Promise<SpawnResult>;
}): ContainerFixtureResetExecutor {
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
		const inspectNetwork = () =>
			spawn(
				[
					params.dockerBin ?? "docker",
					"network",
					"inspect",
					fixture.networkName,
					"--format",
					"{{.Internal}}",
				],
				30,
			);
		let inspected = await inspectNetwork();
		if (inspected.exitCode !== 0) {
			const created = await spawn(
				[
					params.dockerBin ?? "docker",
					"network",
					"create",
					"--internal",
					fixture.networkName,
				],
				30,
			);
			if (created.timedOut || created.exitCode !== 0)
				throw new Error("zap_active_container_fixture_network_create_failed");
			inspected = await inspectNetwork();
		}
		if (
			inspected.timedOut ||
			inspected.exitCode !== 0 ||
			inspected.stdout.trim() !== "true"
		)
			throw new Error("zap_active_container_fixture_network_not_internal");
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
				fixture.networkName,
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
		teardown: async () => {
			try {
				const removed = await spawn(
					[params.dockerBin ?? "docker", "rm", "-f", fixture.containerName],
					30,
				);
				if (
					removed.timedOut ||
					(removed.exitCode !== 0 &&
						!removed.stderr.toLowerCase().includes("no such container"))
				)
					return {
						ok: false,
						errorCode: "zap_active_container_fixture_teardown_failed",
					};
				return { ok: true };
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
				networkName: fixture.networkName,
				nodeBin: fixture.nodeBin,
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
	const result = await runBoundedProcess({
		argv: args,
		timeoutMs: timeoutSec * 1_000,
		outputLimitBytes: FIXTURE_PROCESS_OUTPUT_LIMIT_BYTES,
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		timedOut: result.terminationReason === "timeout",
	};
}

async function spawnWithStdin(
	args: string[],
	stdin: string,
	timeoutSec: number,
	signal?: AbortSignal | null,
): Promise<SpawnResult> {
	const result = await runBoundedProcess({
		argv: args,
		stdin,
		timeoutMs: timeoutSec * 1_000,
		outputLimitBytes: FIXTURE_PROCESS_OUTPUT_LIMIT_BYTES,
		signal,
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
		timedOut: result.terminationReason === "timeout",
	};
}
