import { describe, expect, test } from "bun:test";
import {
	createContainerFixtureLoopbackFetch,
	createContainerFixtureResetExecutor,
	listContainerFixtures,
} from "./container-fixture-reset";

describe("container fixture reset", () => {
	test("rejects loopback transport requests outside the registered fixture", async () => {
		const fixture = listContainerFixtures()[0];
		const fetchImpl = createContainerFixtureLoopbackFetch({
			fixtureId: fixture.fixtureId,
		});
		await expect(fetchImpl("https://example.com/")).rejects.toThrow(
			"zap_active_container_fixture_loopback_target_mismatch",
		);
		await expect(
			fetchImpl("http://127.0.0.1:3000/", {
				method: "POST",
				body: new URLSearchParams({ key: "value" }),
			}),
		).rejects.toThrow(
			"zap_active_container_fixture_loopback_body_unsupported",
		);
	});

	test("recreates only a registered immutable fixture and returns its baseline hash", async () => {
		const fixture = listContainerFixtures()[0];
		const commands: string[][] = [];
		let networkCreated = false;
		const executor = createContainerFixtureResetExecutor({
			strategy: {
				kind: "container_recreate",
				fixtureId: fixture.fixtureId,
				expectedBaselineHash: fixture.expectedBaselineHash,
			},
			targetOrigin: "http://127.0.0.1:3000",
			spawn: async (args) => {
				commands.push(args);
				if (
					args[1] === "network" &&
					args[2] === "inspect" &&
					!networkCreated
				)
					return {
						exitCode: 1,
						stdout: "",
						stderr: "network not found",
						timedOut: false,
					};
				if (args[1] === "network" && args[2] === "create")
					networkCreated = true;
				if (args[1] === "network" && args[2] === "inspect")
					return {
						exitCode: 0,
						stdout: "true\n",
						stderr: "",
						timedOut: false,
					};
				return args[1] === "rm"
					? {
							exitCode: 1,
							stdout: "",
							stderr: "No such container",
							timedOut: false,
						}
					: {
							exitCode: 0,
							stdout: "container-id",
							stderr: "",
							timedOut: false,
						};
			},
			fetchImpl: async () => new Response("ready", { status: 200 }),
		});
		expect(await executor.prepare({
			kind: "container_recreate",
			fixtureId: fixture.fixtureId,
			expectedBaselineHash: fixture.expectedBaselineHash,
		})).toEqual({ baselineHash: fixture.expectedBaselineHash });
		expect(await executor.reset({
			kind: "container_recreate",
			fixtureId: fixture.fixtureId,
			expectedBaselineHash: fixture.expectedBaselineHash,
		})).toEqual({ ok: true, baselineHash: fixture.expectedBaselineHash });
		expect(commands).toHaveLength(8);
		expect(commands[1]).toEqual([
			"docker",
			"network",
			"create",
			"--internal",
			"vuln-workbench-fixture-internal",
		]);
		expect(commands[4]).toContain(fixture.image);
		expect(commands[4]).toContain("--pull");
		expect(commands[4]).toContain("never");
		expect(commands[4]).toContain("--network");
		expect(commands[4]).toContain("vuln-workbench-fixture-internal");
		expect(commands[4]).not.toContain("--publish");
		expect(commands[4]).not.toContain("host");
		expect(await executor.teardown()).toEqual({ ok: true });
		expect(commands).toHaveLength(9);
		expect(commands.at(-1)?.slice(0, 3)).toEqual(["docker", "rm", "-f"]);
	});

	test("serializes recreation of a shared container fixture", async () => {
		const fixture = listContainerFixtures()[0];
		let signalHealthCheck: () => void = () => undefined;
		const healthCheckStarted = new Promise<void>((resolve) => {
			signalHealthCheck = resolve;
		});
		let releaseHealthCheck: () => void = () => undefined;
		const healthCheckGate = new Promise<void>((resolve) => {
			releaseHealthCheck = resolve;
		});
		const strategy = {
			kind: "container_recreate" as const,
			fixtureId: fixture.fixtureId,
			expectedBaselineHash: fixture.expectedBaselineHash,
		};
		const spawn = async (args: string[]) => ({
			exitCode: 0,
			stdout:
				args[1] === "network" && args[2] === "inspect"
					? "true\n"
					: "container-id",
			stderr: "",
			timedOut: false,
		});
		const first = createContainerFixtureResetExecutor({
			strategy,
			targetOrigin: "http://127.0.0.1:3000",
			spawn,
			fetchImpl: async () => {
				signalHealthCheck();
				await healthCheckGate;
				return new Response("ready", { status: 200 });
			},
		});
		const second = createContainerFixtureResetExecutor({
			strategy,
			targetOrigin: "http://127.0.0.1:3000",
			spawn,
			fetchImpl: async () => new Response("ready", { status: 200 }),
		});
		const firstPreparation = first.prepare(strategy);
		await healthCheckStarted;
		await expect(second.prepare(strategy)).rejects.toThrow(
			"zap_active_container_fixture_busy",
		);
		releaseHealthCheck();
		await expect(firstPreparation).resolves.toEqual({
			baselineHash: fixture.expectedBaselineHash,
		});
		await expect(first.reset(strategy)).resolves.toMatchObject({ ok: true });
		await expect(second.prepare(strategy)).resolves.toEqual({
			baselineHash: fixture.expectedBaselineHash,
		});
		await expect(second.reset(strategy)).resolves.toMatchObject({ ok: true });
	});

	test("rejects unknown fixtures, mismatched baselines, and non-fixture targets", () => {
		const fixture = listContainerFixtures()[0];
		expect(() =>
			createContainerFixtureResetExecutor({
				strategy: {
					kind: "container_recreate",
					fixtureId: "unknown",
					expectedBaselineHash: fixture.expectedBaselineHash,
				},
				targetOrigin: "http://127.0.0.1:3000",
			}),
		).toThrow("zap_active_container_fixture_not_registered");
		expect(() =>
			createContainerFixtureResetExecutor({
				strategy: {
					kind: "container_recreate",
					fixtureId: fixture.fixtureId,
					expectedBaselineHash: `sha256:${"a".repeat(64)}`,
				},
				targetOrigin: "http://127.0.0.1:3000",
			}),
		).toThrow("zap_active_container_fixture_baseline_mismatch");
		expect(() =>
			createContainerFixtureResetExecutor({
				strategy: {
					kind: "container_recreate",
					fixtureId: fixture.fixtureId,
					expectedBaselineHash: fixture.expectedBaselineHash,
				},
				targetOrigin: "http://127.0.0.1:4000",
			}),
		).toThrow("zap_active_container_fixture_target_mismatch");
	});

	test("rejects a pre-existing network that is not internal", async () => {
		const fixture = listContainerFixtures()[0];
		const strategy = {
			kind: "container_recreate" as const,
			fixtureId: fixture.fixtureId,
			expectedBaselineHash: fixture.expectedBaselineHash,
		};
		const executor = createContainerFixtureResetExecutor({
			strategy,
			targetOrigin: "http://127.0.0.1:3000",
			spawn: async () => ({
				exitCode: 0,
				stdout: "false\n",
				stderr: "",
				timedOut: false,
			}),
		});
		await expect(executor.prepare(strategy)).rejects.toThrow(
			"zap_active_container_fixture_network_not_internal",
		);
	});
});
