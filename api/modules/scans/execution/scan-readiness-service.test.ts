import { describe, expect, test } from "bun:test";
import { evaluateScanReadiness } from "./scan-readiness-service";

describe("scan readiness service", () => {
	test("hashes nested preview input canonically", async () => {
		const dependencyProbe = async () => ({ exitCode: 0 });
		const first = await evaluateScanReadiness({
			profileId: "source-assurance",
			target: { kind: "full" },
			input: { kind: "source_target", nested: { b: 2, a: 1 } },
			runDependencyProbe: dependencyProbe,
		});
		const second = await evaluateScanReadiness({
			profileId: "source-assurance",
			target: { kind: "full" },
			input: { nested: { a: 1, b: 2 }, kind: "source_target" },
			runDependencyProbe: dependencyProbe,
		});
		expect(first.readinessHash).toBe(second.readinessHash);
		expect(first.planHash).toBe(second.planHash);
	});

	test("blocks runtime passive before a scan when its image is unavailable", async () => {
		const result = await evaluateScanReadiness({
			profileId: "runtime-passive", target: { kind: "full" }, input: { kind: "auto_project_runtime", executionConsent: true },
			settings: { VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE: `registry.example/nuclei@sha256:${"a".repeat(64)}` },
			runDependencyProbe: async () => ({ exitCode: 1 }),
		});
		expect(result).toMatchObject({ readiness: "blocked_environment", reasonCodes: ["docker_daemon_unavailable", "docker_image_unavailable"] });
		expect(result.planHash).toBeNull();
	});

	test("classifies missing input without probing the environment", async () => {
		let calls = 0;
		const result = await evaluateScanReadiness({ profileId: "runtime-passive", target: { kind: "full" }, input: {}, runDependencyProbe: async () => { calls += 1; return { exitCode: 0 }; } });
		expect(result.readiness).toBe("needs_input");
		expect(calls).toBe(0);
	});
});
