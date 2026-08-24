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
			workspacePath: process.cwd(),
		});
		const second = await evaluateScanReadiness({
			profileId: "source-assurance",
			target: { kind: "full" },
			input: { nested: { a: 1, b: 2 }, kind: "source_target" },
			runDependencyProbe: dependencyProbe,
			workspacePath: process.cwd(),
		});
		expect(first.readinessHash).toBe(second.readinessHash);
		expect(first.planHash).toBe(second.planHash);
	});

	test("blocks runtime passive before a scan when its image is unavailable", async () => {
		const result = await evaluateScanReadiness({
			profileId: "runtime-passive", target: { kind: "full" }, input: { kind: "auto_project_runtime", executionConsent: true },
			settings: { VULN_WORKBENCH_RUNTIME_NUCLEI_IMAGE: `registry.example/nuclei@sha256:${"a".repeat(64)}` },
			runDependencyProbe: async () => ({ exitCode: 1 }),
			workspacePath: process.cwd(),
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

	test("does not probe when execution consent is missing", async () => {
		let calls = 0;
		const result = await evaluateScanReadiness({
			profileId: "runtime-passive",
			target: { kind: "full" },
			input: { kind: "auto_project_runtime" },
			runDependencyProbe: async () => {
				calls += 1;
				return { exitCode: 0 };
			},
		});
		expect(result.readiness).toBe("needs_input");
		expect(calls).toBe(0);
	});

	test("does not block a core source profile when optional Semgrep is absent", async () => {
		const commands: string[] = [];
		const result = await evaluateScanReadiness({
			profileId: "source-assurance",
			target: { kind: "full" },
			input: { kind: "source_target" },
			optionalScannerSelections: { semgrep: "preferred" },
			workspacePath: process.cwd(),
			runDependencyProbe: async (command) => {
				commands.push(command);
				return { exitCode: command === "semgrep" ? 1 : 0 };
			},
		});

		expect(result.readiness).toBe("ready");
		expect(result.reasonCodes).toEqual([]);
		expect(result.warningCodes).toEqual([
			"dependency_unavailable:scanner.zizmor",
			"optional_scanner_unavailable:semgrep",
		]);
		expect(commands).toContain("semgrep");
	});

	test("blocks only when unavailable Semgrep was selected as must-run", async () => {
		const result = await evaluateScanReadiness({
			profileId: "source-assurance",
			target: { kind: "full" },
			input: { kind: "source_target" },
			optionalScannerSelections: { semgrep: "required" },
			workspacePath: process.cwd(),
			runDependencyProbe: async (command) => ({
				exitCode: command === "semgrep" ? 1 : 0,
			}),
		});

		expect(result.readiness).toBe("blocked_environment");
		expect(result.reasonCodes).toEqual(["host_binary_unavailable"]);
		expect(result.warningCodes).toEqual([
			"dependency_unavailable:scanner.zizmor",
		]);
	});

	test("binds the optional Semgrep step only when it is selected", async () => {
		const common = {
			profileId: "source-assurance" as const,
			target: { kind: "full" as const },
			input: { kind: "source_target" },
			runDependencyProbe: async () => ({ exitCode: 0 }),
			workspacePath: process.cwd(),
		};
		const disabled = await evaluateScanReadiness({
			...common,
			optionalScannerSelections: { semgrep: "disabled" },
		});
		const preferred = await evaluateScanReadiness({
			...common,
			optionalScannerSelections: { semgrep: "preferred" },
		});

		expect(disabled.readiness).toBe("ready");
		expect(preferred.readiness).toBe("ready");
		expect(disabled.planHash).not.toBe(preferred.planHash);
	});
});
