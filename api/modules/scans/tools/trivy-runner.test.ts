import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStorage } from "../artifact-storage";
import { ARTIFACT_SCOPE, SOURCE_BASELINE_SCOPE } from "../profiles";
import { TrivyRunner } from "./trivy-runner";

describe("TrivyRunner", () => {
	let tempDir: string;
	let artifactRoot: string;
	let storage: ArtifactStorage;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trivy-runner-test-"));
		artifactRoot = path.join(tempDir, "artifacts");
		storage = new ArtifactStorage(artifactRoot);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should return null if trivy version fails (missing executable)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const runner = new TrivyRunner(storage);
		const version = await runner.checkVersion();
		expect(version).toBeNull();

		const result = await runner.run("scan-1", tempDir);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Trivy executable not found");
	});

	it("should run trivy successfully when exitCode is 0 and empty results are produced", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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
				writePromise = fs.writeFile(outPath, JSON.stringify({ Results: [] }));
			}

			return {
				exited: writePromise.then(() => 0),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("trivy stdout"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("trivy stderr"));
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("trivy stdout");
		expect(result.stderr).toBe("trivy stderr");
		expect(result.rawJson).toEqual({ Results: [] });
		expect(result.rawJsonArtifact?.path).toContain("trivy-result.json");
		expect(result.stdoutArtifact?.path).toContain("stdout.log");
		expect(result.stderrArtifact?.path).toContain("stderr.log");
	});

	it("should redact secret matches before saving raw JSON artifacts", async () => {
		const slackToken = [
			"xoxb",
			"12345678901",
			"12345678901",
			"abcdefghijklmnopqrstuvwx",
		].join("-");
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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
				writePromise = fs.writeFile(
					outPath,
					JSON.stringify({
						Results: [
							{
								Target: "secrets.txt",
								Class: "secret",
								Secrets: [
									{
										RuleID: "slack-token",
										Title: "Slack Token",
										Severity: "HIGH",
										StartLine: 5,
										EndLine: 5,
										Match: slackToken,
									},
								],
							},
						],
					}),
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

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(JSON.stringify(result.rawJson)).toContain("[REDACTED]");
		expect(JSON.stringify(result.rawJson)).not.toContain(slackToken);

		const rawArtifactPath = path.join(
			artifactRoot,
			result.rawJsonArtifact?.path ?? "",
		);
		const rawArtifact = await fs.readFile(rawArtifactPath, "utf8");
		expect(rawArtifact).toContain("[REDACTED]");
		expect(rawArtifact).not.toContain(slackToken);
	});

	it("should fail when exitCode is non-zero (unlike Semgrep/OSV, standard Trivy run has to exit with 0)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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

			const githubToken = `ghp_${"abcdefghijklmnopqrstuvwxyz0123456789"}`;
			let writePromise = Promise.resolve();
			const outputIdx = args.indexOf("--output");
			if (outputIdx !== -1 && args[outputIdx + 1]) {
				writePromise = fs.writeFile(
					args[outputIdx + 1],
					`{"token":"${githubToken}"`,
				);
			}

			return {
				exited: writePromise.then(() => 1),
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

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		expect(result.stdoutArtifact).toBeDefined();
		expect(result.stderrArtifact).toBeDefined();
		expect(result.rawJsonArtifact).toBeDefined();

		const rawArtifactPath = path.join(
			artifactRoot,
			result.rawJsonArtifact?.path ?? "",
		);
		const rawArtifact = await fs.readFile(rawArtifactPath, "utf8");
		expect(rawArtifact).toContain("[REDACTED]");
		expect(rawArtifact).not.toContain("ghp_");
	});

	it("should fail on timeout", async () => {
		let killCalled = false;
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir, { timeoutSec: 0.01 });

		expect(result.ok).toBe(false);
		expect(killCalled).toBe(true);
		expect(result.error).toBe("trivy execution timed out");
	});

	it("should pass source baseline skip dirs and scanners to trivy", async () => {
		let scanArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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

			scanArgs = [...(args as string[])];
			const outputIdx = scanArgs.indexOf("--output");
			const writePromise =
				outputIdx !== -1 && scanArgs[outputIdx + 1]
					? fs.writeFile(scanArgs[outputIdx + 1], JSON.stringify({ Results: [] }))
					: Promise.resolve();
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

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir, {
			scope: SOURCE_BASELINE_SCOPE,
			scanners: ["secret"],
		});

		expect(result.ok).toBe(true);
		expect(scanArgs).toEqual(expect.arrayContaining(["--scanners", "secret"]));
		expect(scanArgs).toEqual(expect.arrayContaining(["--skip-dirs", "node_modules"]));
		expect(scanArgs).toEqual(expect.arrayContaining(["--skip-dirs", "dist"]));
	});

	it("should scan a scoped workspace for artifact scope", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tempDir, "dist"), { recursive: true });
		await fs.writeFile(path.join(tempDir, "src", "app.ts"), "export {};\n");
		await fs.writeFile(path.join(tempDir, "dist", "bundle.js"), "bundle();\n");

		let scanArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "trivy" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("0.48.0\n"));
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

			scanArgs = [...(args as string[])];
			const outputIdx = scanArgs.indexOf("--output");
			const writePromise =
				outputIdx !== -1 && scanArgs[outputIdx + 1]
					? fs.writeFile(scanArgs[outputIdx + 1], JSON.stringify({ Results: [] }))
					: Promise.resolve();
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

		const runner = new TrivyRunner(storage);
		const result = await runner.run("scan-123", tempDir, {
			scope: ARTIFACT_SCOPE,
			scanners: ["vuln", "secret"],
		});

		expect(result.ok).toBe(true);
		expect(scanArgs).toEqual(
			expect.arrayContaining(["--scanners", "vuln,secret"]),
		);
		expect(scanArgs).not.toContain("--skip-dirs");
		expect(path.resolve(scanArgs.at(-1) ?? "")).not.toBe(path.resolve(tempDir));
		expect(result.executionMetadata?.scopeWorkspace).toEqual({
			applied: true,
			copiedFiles: 1,
		});
	});
});
