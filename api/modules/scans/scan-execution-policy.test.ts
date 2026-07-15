import { describe, expect, it } from "vitest";
import { resolveScanExecutionPolicy } from "./scan-execution-policy";

const baseEnv = {
	nodeEnv: "development" as const,
	scanExecutionMode: undefined,
	allowHostScannerExecution: true,
	scanDockerImage: undefined,
};

describe("resolveScanExecutionPolicy", () => {
	it("preserves host compatibility in development", () => {
		expect(
			resolveScanExecutionPolicy({ env: baseEnv, surface: "web" }),
		).toMatchObject({ runner: "host", source: "default", networkMode: "none" });
	});

	it("requires docker by default in production", () => {
		expect(
			resolveScanExecutionPolicy({
				env: {
					...baseEnv,
					nodeEnv: "production",
					allowHostScannerExecution: false,
				},
				surface: "web",
			}),
		).toMatchObject({ runner: "docker", source: "default" });
	});

	it("rejects a host request when host execution is disabled", () => {
		expect(() =>
			resolveScanExecutionPolicy({
				env: { ...baseEnv, allowHostScannerExecution: false },
				surface: "web",
				requestedRunner: "host",
			}),
		).toThrow(/Host scanner execution is disabled/);
	});

	it("does not let the security oracle override configured policy", () => {
		expect(
			resolveScanExecutionPolicy({
				env: {
					...baseEnv,
					scanExecutionMode: "docker",
					scanDockerImage: "scanner:test",
				},
				surface: "security_oracle",
				requestedRunner: "host",
			}),
		).toMatchObject({
			runner: "docker",
			dockerImage: "scanner:test",
			source: "environment",
		});
	});
});
