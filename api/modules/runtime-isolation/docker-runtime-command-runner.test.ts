import { describe, expect, it } from "vitest";
import { createDockerRuntimeCommandRunner } from "./docker-runtime-command-runner";

describe("Docker runtime command runner", () => {
	it("terminates a lifecycle command at its deadline", async () => {
		const runner = createDockerRuntimeCommandRunner({ timeoutMs: 20 });
		const result = await runner.run([
			process.execPath,
			"-e",
			"setInterval(() => {}, 1_000)",
		]);

		expect(result.exitCode).toBeNull();
		expect(result.terminationReason).toBe("timeout");
		expect(result.stderr).toContain("runtime_bundle_command_timeout");
	});
});
