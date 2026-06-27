import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	inferDastTargetStartPlan,
	prepareDastTargetWorkspace,
} from "./target-preparer";

describe("Dast Target Preparer", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dast-target-plan-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe("inferDastTargetStartPlan", () => {
		it("infers a Bun/Vite dev command with an assigned local port", async () => {
			await fs.writeFile(path.join(tempDir, "bun.lock"), "", "utf8");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "bunx --bun vite",
						start: "bun run api/app/server.ts",
					},
				}),
				"utf8",
			);

			const plan = await inferDastTargetStartPlan({
				repoPath: tempDir,
				port: 32123,
			});

			expect(plan.packageManager).toBe("bun");
			expect(plan.scriptName).toBe("dev");
			expect(plan.origin).toBe("http://127.0.0.1:32123");
			expect(plan.command).toEqual([
				"bun",
				"run",
				"dev",
				"--",
				"--host",
				"127.0.0.1",
				"--port",
				"32123",
				"--strictPort",
			]);
		});

		it("detects pnpm, yarn, and bun.lockb", async () => {
			// Test pnpm
			await fs.writeFile(path.join(tempDir, "pnpm-lock.yaml"), "", "utf8");
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ scripts: { dev: "vite" } }),
				"utf8",
			);
			let plan = await inferDastTargetStartPlan({ repoPath: tempDir, port: 3000 });
			expect(plan.packageManager).toBe("pnpm");
			expect(plan.command).toEqual(["pnpm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "3000", "--strictPort"]);

			// Test yarn
			await fs.unlink(path.join(tempDir, "pnpm-lock.yaml"));
			await fs.writeFile(path.join(tempDir, "yarn.lock"), "", "utf8");
			plan = await inferDastTargetStartPlan({ repoPath: tempDir, port: 3000 });
			expect(plan.packageManager).toBe("yarn");
			expect(plan.command).toEqual(["yarn", "dev", "--host", "127.0.0.1", "--port", "3000", "--strictPort"]);

			// Test bun.lockb
			await fs.unlink(path.join(tempDir, "yarn.lock"));
			await fs.writeFile(path.join(tempDir, "bun.lockb"), "", "utf8");
			plan = await inferDastTargetStartPlan({ repoPath: tempDir, port: 3000 });
			expect(plan.packageManager).toBe("bun");
		});

		it("fails with an actionable message when no start script exists", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({ scripts: { test: "vitest" } }),
				"utf8",
			);

			await expect(
				inferDastTargetStartPlan({ repoPath: tempDir, port: 32123 }),
			).rejects.toThrow("Could not infer how to start the project");
		});

		it("extracts port from script when port parameter is not provided", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						start: "node server.js --port=4567",
					},
				}),
				"utf8",
			);

			const plan = await inferDastTargetStartPlan({
				repoPath: tempDir,
			});
			expect(plan.port).toBe(4567);
			expect(plan.scriptName).toBe("start");
			expect(plan.command).toEqual(["npm", "run", "start", "--"]);
		});

		it("handles PORT environment variable and next dev scripts", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dast: "PORT=8888 next dev",
					},
				}),
				"utf8",
			);

			const plan = await inferDastTargetStartPlan({
				repoPath: tempDir,
			});
			expect(plan.port).toBe(8888);
			expect(plan.scriptName).toBe("dast");
			// Next dev doesn't add extraPortArgs if portFromScript matches and no override was requested
			expect(plan.command).toEqual(["npm", "run", "dast", "--"]);
		});

		it("overrides next dev script port if explicit port parameter is supplied", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "next dev -p 3000",
					},
				}),
				"utf8",
			);

			const plan = await inferDastTargetStartPlan({
				repoPath: tempDir,
				port: 9999,
			});
			expect(plan.port).toBe(9999);
			expect(plan.command).toEqual(["npm", "run", "dev", "--", "-H", "127.0.0.1", "-p", "9999"]);
		});

		it("auto-allocates a free port and warns when framework command is unknown", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "custom-webserver-binary",
					},
				}),
				"utf8",
			);

			const plan = await inferDastTargetStartPlan({
				repoPath: tempDir,
			});
			expect(plan.port).toBeGreaterThan(0);
			expect(plan.warnings).toHaveLength(1);
			expect(plan.warnings[0]).toContain("Start script does not advertise a known framework port flag");
		});
	});

	describe("prepareDastTargetWorkspace", () => {
		it("spawns the startup process, polls for readiness, and returns the workspace config", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "vite --port 3000",
					},
				}),
				"utf8",
			);

			let killedWithSignal: string | undefined;
			let cleanExited = false;

			const mockProcess = {
				exited: new Promise<number>((resolve) => {
					// simulate clean exit when stopped
					const checkExit = () => {
						if (killedWithSignal) {
							cleanExited = true;
							resolve(0);
						} else {
							setTimeout(checkExit, 50);
						}
					};
					checkExit();
				}),
				kill: (signal?: string) => {
					killedWithSignal = signal || "SIGTERM";
				},
			};

			const mockSpawn = vi.fn().mockReturnValue(mockProcess);

			// Mock fetch readiness
			let fetchCallCount = 0;
			const mockFetchImpl = vi.fn().mockImplementation(async (url: string) => {
				fetchCallCount++;
				if (fetchCallCount === 1) {
					// Fail first attempt
					throw new Error("Connection refused");
				}
				// Succeed on second
				return new Response("OK", { status: 200 });
			});

			const workspace = await prepareDastTargetWorkspace({
				repoPath: tempDir,
				port: 12345,
				readinessTimeoutMs: 5000,
				spawn: mockSpawn as any,
				fetchImpl: mockFetchImpl as any,
			});

			expect(workspace.origin).toBe("http://127.0.0.1:12345");
			expect(workspace.plan.port).toBe(12345);
			expect(mockSpawn).toHaveBeenCalled();
			expect(fetchCallCount).toBe(2);

			// Check stop process triggers SIGTERM
			await workspace.stop();
			expect(killedWithSignal).toBe("SIGTERM");
			expect(cleanExited).toBe(true);
		});

		it("should clean up and throw error if readiness checks persistently fail (timeout)", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "vite --port 3000",
					},
				}),
				"utf8",
			);

			let killedWithSignal: string | undefined;
			const mockProcess = {
				exited: Promise.resolve(0),
				kill: (signal?: string) => {
					killedWithSignal = signal || "SIGTERM";
				},
			};

			const mockSpawn = vi.fn().mockReturnValue(mockProcess);
			const mockFetchImpl = vi.fn().mockRejectedValue(new Error("Always connection refused"));

			await expect(
				prepareDastTargetWorkspace({
					repoPath: tempDir,
					port: 12346,
					readinessTimeoutMs: 200,
					spawn: mockSpawn as any,
					fetchImpl: mockFetchImpl as any,
				})
			).rejects.toThrow("DAST auto target did not become ready");

			// Verify it cleaned up the process
			expect(killedWithSignal).toBe("SIGTERM");
		});

		it("falls back to SIGKILL if process does not exit in 3 seconds", async () => {
			await fs.writeFile(
				path.join(tempDir, "package.json"),
				JSON.stringify({
					scripts: {
						dev: "vite --port 3000",
					},
				}),
				"utf8",
			);

			const signalsKilled: string[] = [];
			let resolveExit: (code: number) => void;
			const mockProcess = {
				exited: new Promise<number>((r) => {
					resolveExit = r;
				}),
				kill: (signal?: string) => {
					signalsKilled.push(signal || "SIGTERM");
					if (signal === "SIGKILL") {
						resolveExit(9);
					}
				},
			};

			const mockSpawn = vi.fn().mockReturnValue(mockProcess);
			const mockFetchImpl = vi.fn().mockResolvedValue(new Response("OK", { status: 200 }));

			// Use fake timers to speed up the 3 second timeout in stopProcess
			vi.useFakeTimers();

			const workspace = await prepareDastTargetWorkspace({
				repoPath: tempDir,
				port: 12347,
				readinessTimeoutMs: 1000,
				spawn: mockSpawn as any,
				fetchImpl: mockFetchImpl as any,
			});

			const stopPromise = workspace.stop();
			
			// Fast forward 3 seconds
			vi.advanceTimersByTime(3500);

			await stopPromise;

			expect(signalsKilled).toContain("SIGTERM");
			expect(signalsKilled).toContain("SIGKILL");
			
			vi.useRealTimers();
		});
	});
});
