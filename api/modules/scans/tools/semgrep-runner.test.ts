import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SemgrepRunner } from "./semgrep-runner";
import { ArtifactStorage } from "../artifact-storage";

describe("SemgrepRunner", () => {
	let tempDir: string;
	let artifactRoot: string;
	let storage: ArtifactStorage;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "semgrep-runner-test-"));
		artifactRoot = path.join(tempDir, "artifacts");
		storage = new ArtifactStorage(artifactRoot);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should return null if semgrep --version fails (missing executable)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const runner = new SemgrepRunner(storage);
		const version = await runner.checkVersion();
		expect(version).toBeNull();

		const result = await runner.run("scan-1", tempDir);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Semgrep executable not found");
	});

	it("should run semgrep successfully when exitCode is 0 and valid JSON output is produced", async () => {
		// Mock checkVersion
		let spawnCallCount = 0;
		const mockSpawn = vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			spawnCallCount++;
			if (args[0] === "semgrep" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.2.3\n"));
							controller.close();
						},
					}),
					stderr: new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
				} as any;
			}

			// Capture the output path argument and write a mock json result file to it
			let writePromise = Promise.resolve();
			const outputIdx = args.indexOf("--output");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				const outPath = args[outputIdx + 1];
				writePromise = fs.writeFile(outPath, JSON.stringify({ results: [] }));
			}

			return {
				exited: writePromise.then(() => 0),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("scan stdout"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("scan stderr"));
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new SemgrepRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("scan stdout");
		expect(result.stderr).toBe("scan stderr");
		expect(result.rawJson).toEqual({ results: [] });
		expect(result.rawJsonArtifact?.path).toContain("semgrep-result.json");
		expect(result.stdoutArtifact?.path).toContain("stdout.log");
		expect(result.stderrArtifact?.path).toContain("stderr.log");
	});

	it("should run semgrep successfully when exitCode is 1 but has valid JSON (findings present)", async () => {
		const mockSpawn = vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "semgrep" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.2.3\n"));
							controller.close();
						},
					}),
					stderr: new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
				} as any;
			}

			let writePromise = Promise.resolve();
			const outputIdx = args.indexOf("--output");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				const outPath = args[outputIdx + 1];
				writePromise = fs.writeFile(outPath, JSON.stringify({ results: [{ check_id: "rules.some" }] }));
			}

			return {
				exited: writePromise.then(() => 1),
				stdout: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new SemgrepRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.rawJson).toEqual({ results: [{ check_id: "rules.some" }] });
	});

	it("should fail when exitCode is non-zero without valid JSON output", async () => {
		const mockSpawn = vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "semgrep" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.2.3\n"));
							controller.close();
						},
					}),
					stderr: new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
				} as any;
			}

			return {
				exited: Promise.resolve(2),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("Error log"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("Critical failure"));
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new SemgrepRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(2);
		expect(result.stdoutArtifact).toBeDefined();
		expect(result.stderrArtifact).toBeDefined();
		expect(result.rawJsonArtifact).toBeUndefined();
	});

	it("should fail on timeout", async () => {
		let killCalled = false;
		const mockSpawn = vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "semgrep" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.2.3\n"));
							controller.close();
						},
					}),
					stderr: new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
				} as any;
			}

			return {
				kill() {
					killCalled = true;
				},
				exited: new Promise((resolve) => {
					// Never resolves on its own, relies on timeout to terminate/resolve
					setTimeout(() => resolve(15), 50);
				}),
				stdout: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new SemgrepRunner(storage);
		// Force small timeout for testing
		const result = await runner.run("scan-123", tempDir, { timeoutSec: 0.01 });

		expect(result.ok).toBe(false);
		expect(killCalled).toBe(true);
		expect(result.error).toBe("Semgrep execution timed out");
	});

	it("should not pass sensitive environment variables to semgrep", async () => {
		const originalEnv = {
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
			AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
			LLM_TOKEN: process.env.LLM_TOKEN,
			SECRET_VALUE: process.env.SECRET_VALUE,
			CUSTOM_KEY: process.env.CUSTOM_KEY,
			SEMGREP_APP_TOKEN: process.env.SEMGREP_APP_TOKEN,
		};
		process.env.OPENAI_API_KEY = "openai-secret";
		process.env.AZURE_OPENAI_API_KEY = "azure-secret";
		process.env.LLM_TOKEN = "llm-secret";
		process.env.SECRET_VALUE = "secret";
		process.env.CUSTOM_KEY = "key-secret";
		process.env.SEMGREP_APP_TOKEN = "semgrep-token";

		let semgrepEnv: Record<string, string> | undefined;
		vi.spyOn(Bun, "spawn").mockImplementation((args, options) => {
			if (args[0] === "semgrep" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.2.3\n"));
							controller.close();
						},
					}),
					stderr: new ReadableStream({
						start(controller) {
							controller.close();
						},
					}),
				} as any;
			}

			semgrepEnv = options?.env as Record<string, string>;
			let writePromise = Promise.resolve();
			const outputIdx = args.indexOf("--output");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				writePromise = fs.writeFile(
					args[outputIdx + 1],
					JSON.stringify({ results: [] }),
				);
			}

			return {
				exited: writePromise.then(() => 0),
				stdout: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					},
				}),
			} as any;
		});

		try {
			const runner = new SemgrepRunner(storage);
			const result = await runner.run("scan-123", tempDir);
			expect(result.ok).toBe(true);
			expect(semgrepEnv).toBeDefined();
			expect(semgrepEnv?.OPENAI_API_KEY).toBeUndefined();
			expect(semgrepEnv?.AZURE_OPENAI_API_KEY).toBeUndefined();
			expect(semgrepEnv?.LLM_TOKEN).toBeUndefined();
			expect(semgrepEnv?.SECRET_VALUE).toBeUndefined();
			expect(semgrepEnv?.CUSTOM_KEY).toBeUndefined();
			expect(semgrepEnv?.SEMGREP_APP_TOKEN).toBeUndefined();
		} finally {
			for (const [key, value] of Object.entries(originalEnv)) {
				if (value === undefined) {
					delete process.env[key];
				} else {
					process.env[key] = value;
				}
			}
		}
	});
});
