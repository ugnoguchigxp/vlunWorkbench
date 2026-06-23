import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitleaksRunner } from "./gitleaks-runner";
import { ArtifactStorage } from "../artifact-storage";

describe("GitleaksRunner", () => {
	let tempDir: string;
	let artifactRoot: string;
	let storage: ArtifactStorage;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gitleaks-runner-test-"));
		artifactRoot = path.join(tempDir, "artifacts");
		storage = new ArtifactStorage(artifactRoot);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should return null if gitleaks version fails (missing executable)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const runner = new GitleaksRunner(storage);
		const version = await runner.checkVersion();
		expect(version).toBeNull();

		const result = await runner.run("scan-1", tempDir);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Gitleaks executable not found");
	});

	it("should run gitleaks successfully when exitCode is 0 and empty JSON output is produced", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("8.18.0\n"));
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
			const outputIdx = args.indexOf("--report-path");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				const outPath = args[outputIdx + 1];
				writePromise = fs.writeFile(outPath, JSON.stringify([]));
			}

			return {
				exited: writePromise.then(() => 0),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("gitleaks stdout"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("gitleaks stderr"));
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new GitleaksRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("gitleaks stdout");
		expect(result.stderr).toBe("gitleaks stderr");
		expect(result.rawJson).toEqual([]);
		expect(result.rawJsonArtifact?.path).toContain("gitleaks-result.json");
		expect(result.stdoutArtifact?.path).toContain("stdout.log");
		expect(result.stderrArtifact?.path).toContain("stderr.log");
	});

	it("should run gitleaks successfully when exitCode is 1 but has valid JSON (findings present)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("8.18.0\n"));
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
			const outputIdx = args.indexOf("--report-path");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				const outPath = args[outputIdx + 1];
				writePromise = fs.writeFile(
					outPath,
					JSON.stringify([
						{
							Description: "Generic Secret",
							StartLine: 1,
							EndLine: 1,
							File: "src/auth.ts",
							Secret: "sensitive",
							RuleID: "secret-rule",
						},
					]),
				);
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

		const runner = new GitleaksRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.rawJson).toEqual([
			{
				Description: "Generic Secret",
				StartLine: 1,
				EndLine: 1,
				File: "src/auth.ts",
				Secret: "[REDACTED]",
				RuleID: "secret-rule",
			},
		]);
		const rawArtifactPath = path.join(
			artifactRoot,
			result.rawJsonArtifact?.path ?? "",
		);
		const rawArtifact = await fs.readFile(rawArtifactPath, "utf8");
		expect(rawArtifact).toContain("[REDACTED]");
		expect(rawArtifact).not.toContain("sensitive");
	});

	it("should fail when exitCode is non-0/1 without valid JSON output", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("8.18.0\n"));
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
			const outputIdx = args.indexOf("--report-path");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				writePromise = fs.writeFile(
					args[outputIdx + 1],
					'{"Secret":"AKIAIOSFODNN7EXAMPLE"',
				);
			}

			return {
				exited: writePromise.then(() => 2),
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

		const runner = new GitleaksRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(2);
		expect(result.stdoutArtifact).toBeDefined();
		expect(result.stderrArtifact).toBeDefined();
		expect(result.rawJsonArtifact).toBeDefined();

		const rawArtifactPath = path.join(
			artifactRoot,
			result.rawJsonArtifact?.path ?? "",
		);
		const rawArtifact = await fs.readFile(rawArtifactPath, "utf8");
		expect(rawArtifact).toContain("[REDACTED]");
		expect(rawArtifact).not.toContain("AKIAIOSFODNN7EXAMPLE");
	});

	it("should fail on timeout", async () => {
		let killCalled = false;
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("8.18.0\n"));
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

		const runner = new GitleaksRunner(storage);
		const result = await runner.run("scan-123", tempDir, { timeoutSec: 0.01 });

		expect(result.ok).toBe(false);
		expect(killCalled).toBe(true);
		expect(result.error).toBe("gitleaks execution timed out");
	});

	it("should not pass sensitive environment variables to gitleaks", async () => {
		const originalEnv = {
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
			LLM_TOKEN: process.env.LLM_TOKEN,
		};
		process.env.OPENAI_API_KEY = "openai-secret";
		process.env.LLM_TOKEN = "llm-secret";

		let gitleaksEnv: Record<string, string> | undefined;
		vi.spyOn(Bun, "spawn").mockImplementation((args, options) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("8.18.0\n"));
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

			gitleaksEnv = options?.env as Record<string, string>;
			let writePromise = Promise.resolve();
			const outputIdx = args.indexOf("--report-path");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				writePromise = fs.writeFile(args[outputIdx + 1], JSON.stringify([]));
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
			const runner = new GitleaksRunner(storage);
			const result = await runner.run("scan-123", tempDir);
			expect(result.ok).toBe(true);
			expect(gitleaksEnv).toBeDefined();
			expect(gitleaksEnv?.OPENAI_API_KEY).toBeUndefined();
			expect(gitleaksEnv?.LLM_TOKEN).toBeUndefined();
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
