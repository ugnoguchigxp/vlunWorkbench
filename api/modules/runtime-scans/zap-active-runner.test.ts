import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ArtifactStorage } from "../scans/artifact-storage";
import {
	buildZapActiveDockerCommand,
	type ActiveResetExecutor,
	ZapActiveRunner,
} from "./zap-active-runner";

let tempRoot: string | null = null;

afterEach(async () => {
	if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
	tempRoot = null;
});

const baselineHash = `sha256:${"a".repeat(64)}`;
const resetStrategy = {
	kind: "container_recreate" as const,
	fixtureId: "fixture",
	expectedBaselineHash: baselineHash,
};

describe("ZAP active runner", () => {
	test("uses a pinned resource-bounded Docker contract", () => {
		const command = buildZapActiveDockerCommand({
			dockerBin: "docker",
			networkName: "internal-network",
			containerName: "zap-active",
			outputDir: "/tmp/zap-output",
		});
		expect(command).toContain("--network");
		expect(command).toContain("internal-network");
		expect(command).toContain("--read-only");
		expect(command).toContain("--memory");
		expect(command).toContain("--pids-limit");
		expect(command.join(" ")).not.toContain("latest");
	});

	test("completes only after reset and produces redacted normalized findings", async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "zap-active-test-"));
		const reset = resetExecutor(true);
		const runner = new ZapActiveRunner(new ArtifactStorage(tempRoot), reset, {
			networkFactory: async () => ({
				name: "fixture-network",
				gatewayAddress: "127.0.0.1",
				stop: async () => undefined,
			}),
			spawn: async (args) => {
				const mount = args[args.indexOf("-v") + 1].split(":", 1)[0];
				await writeFile(
					path.join(mount, "zap-active-report.json"),
					JSON.stringify(report("http://127.0.0.1:1/api/items")),
				);
				return { exitCode: 0, stdout: "done", stderr: "", timedOut: false };
			},
		});
		const result = await runner.run({
			scanRunId: "00000000-0000-4000-8000-000000000001",
			upstreamOrigin: "http://127.0.0.1:9",
			allowedMethods: ["GET", "POST"],
			allowedPaths: ["/api"],
			requestBudget: 10,
			rateLimitPerSec: 2,
			durationSec: 60,
			rules: [{ id: 40012 }],
			resetStrategy,
		});
		expect(result.status).toBe("completed");
		expect(result.cleanupSucceeded).toBe(true);
		expect(result.findings).toHaveLength(1);
		expect(result.metadata).toMatchObject({ networkMode: "internal" });
		expect(
			await readFile(path.join(tempRoot, result.rawArtifact?.path ?? ""), "utf8"),
		).toContain("40012");
	});

	test("fails closed for cleanup mismatch and credential canary leakage", async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "zap-active-test-"));
		const runner = new ZapActiveRunner(
			new ArtifactStorage(tempRoot),
			resetExecutor(false),
			{
				networkFactory: async () => ({
					name: "fixture-network",
					gatewayAddress: "127.0.0.1",
					stop: async () => undefined,
				}),
				spawn: async (args) => {
					const mount = args[args.indexOf("-v") + 1].split(":", 1)[0];
					await writeFile(
						path.join(mount, "zap-active-report.json"),
						JSON.stringify(report("http://127.0.0.1/api?token=canary-value")),
					);
					return {
						exitCode: 0,
						stdout: "canary-value",
						stderr: "",
						timedOut: false,
					};
				},
			},
		);
		const result = await runner.run({
			scanRunId: "00000000-0000-4000-8000-000000000002",
			upstreamOrigin: "http://127.0.0.1:9",
			allowedMethods: ["GET"],
			allowedPaths: ["/"],
			requestBudget: 10,
			rateLimitPerSec: 2,
			durationSec: 60,
			rules: [{ id: 40012 }],
			resetStrategy,
			authSecret: { kind: "bearer_token", token: "canary-value" },
		});
		expect(result.status).toBe("failed_cleanup");
		expect(result.credentialLeakage).toBe(true);
		expect(result.findings).toEqual([]);
	});

	test("distinguishes paired vulnerable and fixed report fixtures", async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "zap-active-test-"));
		const reports = [
			{
				name: "vulnerable-report.json",
				expectedFindings: 1,
				scanRunId: "00000000-0000-4000-8000-000000000003",
			},
			{
				name: "fixed-report.json",
				expectedFindings: 0,
				scanRunId: "00000000-0000-4000-8000-000000000004",
			},
		];
		for (const fixture of reports) {
			const runner = new ZapActiveRunner(
				new ArtifactStorage(tempRoot),
				resetExecutor(true),
				{
					networkFactory: async () => ({
						name: "fixture-network",
						gatewayAddress: "127.0.0.1",
						stop: async () => undefined,
					}),
					spawn: async (args) => {
						const mount = args[args.indexOf("-v") + 1].split(":", 1)[0];
						await writeFile(
							path.join(mount, "zap-active-report.json"),
							await readFile(
								path.resolve(
									"tests/security-capability/zap-active",
									fixture.name,
								),
								"utf8",
							),
						);
						return {
							exitCode: 0,
							stdout: "",
							stderr: "",
							timedOut: false,
						};
					},
				},
			);
			const result = await runner.run({
				scanRunId: fixture.scanRunId,
				upstreamOrigin: "http://127.0.0.1:9",
				allowedMethods: ["GET"],
				allowedPaths: ["/api"],
				requestBudget: 10,
				rateLimitPerSec: 2,
				durationSec: 60,
				rules: [{ id: 40012 }],
				resetStrategy,
			});
			expect(result.status).toBe("completed");
			expect(result.findings).toHaveLength(fixture.expectedFindings);
		}
	});
});

function resetExecutor(succeeds: boolean): ActiveResetExecutor {
	return {
		prepare: async () => ({ baselineHash }),
		reset: async () => ({
			ok: succeeds,
			baselineHash: succeeds ? baselineHash : `sha256:${"b".repeat(64)}`,
		}),
	};
}

function report(uri: string) {
	return {
		"@programName": "OWASP ZAP",
		"@version": "2.17.0",
		site: [
			{
				"@name": "http://127.0.0.1",
				alerts: [
					{
						pluginid: "40012",
						name: "Reflected XSS",
						riskcode: "3",
						confidence: "3",
						cweid: "79",
						instances: [{ uri, method: "GET", evidence: "<script>" }],
					},
				],
			},
		],
	};
}
