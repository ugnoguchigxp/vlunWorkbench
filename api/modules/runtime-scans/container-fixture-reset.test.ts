import { describe, expect, test } from "bun:test";
import {
	createContainerFixtureResetExecutor,
	listContainerFixtures,
} from "./container-fixture-reset";

describe("container fixture reset", () => {
	test("recreates only a registered immutable fixture and returns its baseline hash", async () => {
		const fixture = listContainerFixtures()[0];
		const commands: string[][] = [];
		const executor = createContainerFixtureResetExecutor({
			strategy: {
				kind: "container_recreate",
				fixtureId: fixture.fixtureId,
				expectedBaselineHash: fixture.expectedBaselineHash,
			},
			targetOrigin: "http://127.0.0.1:3000",
			spawn: async (args) => {
				commands.push(args);
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
		expect(commands).toHaveLength(4);
		expect(commands[1]).toContain(fixture.image);
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
});
