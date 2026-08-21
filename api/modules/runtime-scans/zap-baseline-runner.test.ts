import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recordScannerE2EFailureObservation } from "../../testing/scanner-e2e-failure-observation";
import { ArtifactStorage } from "../scans/artifact-storage";
import { buildZapBaselineDockerCommand, ZapBaselineRunner } from "./zap-baseline-runner";
import { isPinnedZapImage, ZAP_STABLE_IMAGE } from "./zap-image-policy";

const report = JSON.stringify({ "@programName": "ZAP", "@version": "2.17.0", site: [] });
const stream = (value: string) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(value)); controller.close(); } });

describe("ZapBaselineRunner", () => {
	function fakeGateway() {
		return {
			hostOrigin: "http://127.0.0.1:4567",
			containerOrigin: "http://host.docker.internal:4567",
			metrics: () => ({
				forwardedRequests: 0,
				budgetBlockedRequests: 0,
				methodBlockedRequests: 0,
				pathBlockedRequests: 0,
				redirectBlockedResponses: 0,
				responseBytesRead: 0,
				responseBodyTruncatedResponses: 0,
			}),
			stop: async () => undefined,
		};
	}

	function runWithExitCode(exitCode: number, raw = report) {
		return async () => {
			const root = await fs.mkdtemp(path.join(os.tmpdir(), "zap-exit-test-"));
			const storage = new ArtifactStorage(path.join(root, "artifacts"));
			const spawn = (args: string[]) => {
				if (args.includes("python3"))
					return { exited: Promise.resolve(0), stdout: stream("200"), stderr: stream("") };
				const mount = args[args.indexOf("-v") + 1] ?? "";
				const outputDir = mount.split(":/zap/wrk", 1)[0];
				return {
					exited: fs
						.writeFile(path.join(outputDir, "zap-report.json"), raw)
						.then(() => exitCode),
					stdout: stream(""),
					stderr: stream(""),
				};
			};
			const runner = new ZapBaselineRunner(
				storage,
				{ runner: "docker", docker: { dockerBin: "docker" } },
				{ spawn: spawn as any },
			);
			const result = await runner.run({
				scanRunId: "scan-exit",
				upstreamOrigin: "http://127.0.0.1:3000",
				allowedPaths: ["/"],
				excludedPaths: [],
				maxRequests: 20,
				rateLimitPerSec: 10,
				gateway: fakeGateway(),
			});
			await fs.rm(root, { recursive: true, force: true });
			return result;
		};
	}

	it("requires an immutable image index digest", () => {
		expect(isPinnedZapImage(ZAP_STABLE_IMAGE)).toBe(true);
		expect(isPinnedZapImage("zaproxy/zap-stable:sha256-1110082c94217b6e9592b18934740108839a44c02f1d0e961e4933bbb98bab45")).toBe(false);
	});

	it("builds a Docker-only command with the pinned image and no unsafe mounts", () => {
		const args = buildZapBaselineDockerCommand({ containerName: "zap-test", outputDir: "/tmp/out", targetOrigin: "http://host.docker.internal:4000" });
		expect(args).toContain(ZAP_STABLE_IMAGE);
		expect(args.some((arg) => arg.endsWith(":/zap/wrk:rw"))).toBe(true);
		expect(args).toContain("--entrypoint");
		expect(args).toContain("/zap/zap-baseline.py");
		expect(args).not.toContain("--user");
		expect(args).not.toContain("--read-only");
		expect(args.join(" ")).not.toContain("/var/run/docker.sock");
		expect(args.join(" ")).not.toContain("/workspace/repo");
	});

	it("validates and persists only a redacted report", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zap-runner-test-"));
		const storage = new ArtifactStorage(path.join(root, "artifacts"));
		const stop = vi.fn(async () => undefined);
		const gateway = { hostOrigin: "http://127.0.0.1:4567", containerOrigin: "http://host.docker.internal:4567", metrics: () => ({ forwardedRequests: 2, budgetBlockedRequests: 1, methodBlockedRequests: 0, pathBlockedRequests: 0, redirectBlockedResponses: 0, responseBytesRead: 100, responseBodyTruncatedResponses: 0 }), stop };
		const spawn = (args: string[]) => {
			if (args.includes("python3")) return { exited: Promise.resolve(0), stdout: stream("200"), stderr: stream("") };
			const mount = args[args.indexOf("-v") + 1] ?? "";
			const outputDir = mount.split(":/zap/wrk", 1)[0];
			return { exited: fs.writeFile(path.join(outputDir, "zap-report.json"), JSON.stringify({ ...JSON.parse(report), secret: "ghp_abcdefghijklmnopqrstuvwxyz123456789012" })).then(() => 0), stdout: stream(""), stderr: stream("") };
		};
		const runner = new ZapBaselineRunner(storage, { runner: "docker", docker: { dockerBin: "docker" } }, { spawn: spawn as any });
		const result = await runner.run({ scanRunId: "scan-1", upstreamOrigin: "http://127.0.0.1:3000", allowedPaths: ["/"], excludedPaths: [], maxRequests: 20, rateLimitPerSec: 2, gateway });
		expect(result.ok).toBe(true);
		expect(result.rawJson?.["@version"]).toBe("2.17.0");
		expect(result.rawArtifact).toBeDefined();
		expect(result.executionMetadata?.gatewayMetrics).toMatchObject({ forwardedRequests: 2, budgetBlockedRequests: 1 });
		expect(stop).toHaveBeenCalledOnce();
		const stored = await fs.readFile(path.resolve(path.join(root, "artifacts"), result.rawArtifact?.path ?? ""), "utf8");
		expect(stored).not.toContain("ghp_");
		expect(JSON.parse(stored)).toEqual(result.rawJson);
		expect((await fs.stat(path.resolve(path.join(root, "artifacts"), result.rawArtifact?.path ?? ""))).mode & 0o777).toBe(0o600);
		await fs.rm(root, { recursive: true, force: true });
	});

	it("rejects host execution", () => {
		expect(() => new ZapBaselineRunner(new ArtifactStorage(), { runner: "host" })).toThrow("Docker-only");
	});

	it.each([0, 1, 2])("accepts exit %s when the report is valid", async (exitCode) => {
		const result = await runWithExitCode(exitCode)();
		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(exitCode);
	});

	it("rejects execution failures and structurally invalid reports", async () => {
		const failed = await runWithExitCode(3)();
		expect(failed.ok).toBe(false);
		expect(failed.reasonCode).toBe("execution_failed");
		const invalid = await runWithExitCode(0, "{}")();
		expect(invalid.ok).toBe(false);
		expect(invalid.reasonCode).toBe("invalid_structured_output");
		recordScannerE2EFailureObservation("FI-04", {
			profileOutcome: "failed",
			reasonCodes: [invalid.reasonCode ?? "invalid_structured_output"],
			scannerProcessCount: 1,
			toolRunCount: 1,
			artifactCount: 1,
		});
	});

	it("rejects a ZAP report larger than the bounded input limit", async () => {
		const result = await runWithExitCode(
			0,
			" ".repeat(20 * 1024 * 1024 + 1),
		)();

		expect(result.ok).toBe(false);
		expect(result.reasonCode).toBe("invalid_structured_output");
		expect(result.stderr).toContain("ZAP report exceeds");
	});

	it("bounds output collection when a timed-out Docker stream never closes", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "zap-timeout-test-"));
		const storage = new ArtifactStorage(path.join(root, "artifacts"));
		const stop = vi.fn(async () => undefined);
		const neverClosing = () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("pulling image"));
				},
			});
		const runner = new ZapBaselineRunner(
			storage,
			{ runner: "docker", docker: { dockerBin: "docker" } },
			{
				spawn: (() => ({
					exited: new Promise<number>(() => {}),
					stdout: neverClosing(),
					stderr: neverClosing(),
					kill: () => undefined,
				})) as any,
			},
		);
		const startedAt = performance.now();
		const result = await runner.run({
			scanRunId: "scan-timeout",
			upstreamOrigin: "http://127.0.0.1:3000",
			allowedPaths: ["/"],
			excludedPaths: [],
			maxRequests: 20,
			rateLimitPerSec: 2,
			timeoutSec: 0.01,
			gateway: { ...fakeGateway(), stop },
		});

		expect(result.ok).toBe(false);
		expect(result.reasonCode).toBe("target_unreachable_from_container");
		expect(performance.now() - startedAt).toBeLessThan(2_500);
		expect(stop).toHaveBeenCalledOnce();
		await fs.rm(root, { recursive: true, force: true });
	});
});
