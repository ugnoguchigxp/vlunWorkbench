import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OsvRunner } from "./osv-runner";
import { ArtifactStorage } from "../artifact-storage";

describe("OsvRunner", () => {
	let tempDir: string;
	let artifactRoot: string;
	let storage: ArtifactStorage;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "osv-runner-test-"));
		artifactRoot = path.join(tempDir, "artifacts");
		storage = new ArtifactStorage(artifactRoot);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should return null if osv-scanner version fails (missing executable)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});

		const runner = new OsvRunner(storage);
		const version = await runner.checkVersion();
		expect(version).toBeNull();

		const result = await runner.run("scan-1", tempDir);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("OSV-Scanner executable not found");
	});

	it("should run osv-scanner successfully when exitCode is 0 and empty results are produced", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "osv-scanner" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.5.0\n"));
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
				writePromise = fs.writeFile(outPath, JSON.stringify({ results: [] }));
			}

			return {
				exited: writePromise.then(() => 0),
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("osv stdout"));
						controller.close();
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("osv stderr"));
						controller.close();
					},
				}),
			} as any;
		});

		const runner = new OsvRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("osv stdout");
		expect(result.stderr).toBe("osv stderr");
		expect(result.rawJson).toEqual({ results: [] });
		expect(result.rawJsonArtifact?.path).toContain("osv-result.json");
		expect(result.stdoutArtifact?.path).toContain("stdout.log");
		expect(result.stderrArtifact?.path).toContain("stderr.log");
	});

	it("should run osv-scanner successfully when exitCode is 1 but has valid JSON (vulnerabilities present)", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "osv-scanner" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.5.0\n"));
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
						results: [
							{
								source: { path: "package-lock.json", type: "lockfile" },
								packages: [],
							},
						],
					}),
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

		const runner = new OsvRunner(storage);
		const result = await runner.run("scan-123", tempDir);

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(1);
		expect(result.rawJson).toEqual({
			results: [
				{
					source: { path: "package-lock.json", type: "lockfile" },
					packages: [],
				},
			],
		});
	});

	it("should fail when exitCode is non-0/1 without valid JSON output", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "osv-scanner" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.5.0\n"));
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

		const runner = new OsvRunner(storage);
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
		expect(rawArtifact).not.toContain("ghp_");
	});

	it("should fail on timeout", async () => {
		let killCalled = false;
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "osv-scanner" && args[1] === "--version") {
				return {
					exited: Promise.resolve(0),
					stdout: new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("1.5.0\n"));
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

		const runner = new OsvRunner(storage);
		const result = await runner.run("scan-123", tempDir, { timeoutSec: 0.01 });

		expect(result.ok).toBe(false);
		expect(killCalled).toBe(true);
		expect(result.error).toBe("osv-scanner execution timed out");
	});
});
