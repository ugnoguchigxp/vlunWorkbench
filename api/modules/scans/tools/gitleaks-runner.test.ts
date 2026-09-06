import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactStorage } from "../execution/lifecycle/artifact-storage";
import { SOURCE_BASELINE_SCOPE } from "../profiles";
import { GitleaksRunner } from "./gitleaks-runner";

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

	it("should scan a scoped workspace for source baseline scope", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
		await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), {
			recursive: true,
		});
		await fs.writeFile(path.join(tempDir, "src", "app.ts"), "export {};\n");
		await fs.writeFile(
			path.join(tempDir, ".gitleaks.toml"),
			"[extend]\nuseDefault = true\n",
		);
		await fs.writeFile(
			path.join(tempDir, "node_modules", "pkg", "index.js"),
			"module.exports = {};\n",
		);

		let scanSource = "";
		let scanConfig = "";
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

			const sourceIdx = args.indexOf("--source");
			scanSource = sourceIdx === -1 ? "" : (args[sourceIdx + 1] as string);
			const configIdx = args.indexOf("--config");
			scanConfig = configIdx === -1 ? "" : (args[configIdx + 1] as string);
			const outputIdx = args.indexOf("--report-path");
			const writePromise =
				outputIdx !== -1 && args[outputIdx + 1]
					? fs.writeFile(args[outputIdx + 1] as string, JSON.stringify([]))
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

		const runner = new GitleaksRunner(storage);
		const result = await runner.run("scan-123", tempDir, {
			scope: SOURCE_BASELINE_SCOPE,
		});

		expect(result.ok).toBe(true);
		expect(scanSource).toBeTruthy();
		expect(path.resolve(scanSource)).not.toBe(path.resolve(tempDir));
		expect(scanConfig).toBe(path.join(scanSource, ".gitleaks.toml"));
		expect(result.executionMetadata?.scopeWorkspace).toEqual({
			applied: true,
			copiedFiles: 2,
		});
	});

	it("uses the mounted repository as the Docker working directory", async () => {
		await fs.writeFile(
			path.join(tempDir, ".gitleaks.toml"),
			"[extend]\nuseDefault = true\n",
		);
		let dockerArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			dockerArgs = [...(args as string[])];
			const isVersion = dockerArgs.includes("version");
			const outputMount = dockerArgs.find(
				(arg) => arg.includes(":/workspace/out:rw"),
			);
			const outputDirectory = outputMount?.split(":/workspace/out:rw")[0];
			const writePromise =
				!isVersion && outputDirectory
					? fs.writeFile(path.join(outputDirectory, "gitleaks-output.json"), "[]")
					: Promise.resolve();
			return {
				exited: writePromise.then(() => 0),
				stdout: new Response(isVersion ? "8.30.1\n" : "").body,
				stderr: new Response("").body,
			} as any;
		});

		const result = await new GitleaksRunner(storage, {
			runner: "docker",
			docker: { image: "toolbox:test", networkMode: "none" },
		}).run("scan-docker", tempDir, { preScoped: true });

		expect(result.ok).toBe(true);
		expect(dockerArgs).toContain("--workdir");
		expect(dockerArgs).toContain("/workspace/repo");
		expect(dockerArgs).toContain("GIT_CONFIG_COUNT=1");
		expect(dockerArgs).toContain("GIT_CONFIG_KEY_0=safe.directory");
		expect(dockerArgs).toContain("GIT_CONFIG_VALUE_0=/workspace/repo");
		expect(dockerArgs).toContain(".");
		expect(dockerArgs).toContain("/workspace/repo/.gitleaks.toml");
	});

	it("mounts an immutable config beside a pre-scoped diff workspace", async () => {
		const changedWorkspace = path.join(tempDir, "changed");
		const targetSnapshot = path.join(tempDir, "target");
		await fs.mkdir(changedWorkspace);
		await fs.mkdir(targetSnapshot);
		const configPath = path.join(targetSnapshot, ".gitleaks.toml");
		await fs.writeFile(configPath, "[extend]\nuseDefault = true\n");
		let dockerArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			dockerArgs = [...(args as string[])];
			const isVersion = dockerArgs.includes("version");
			const outputMount = dockerArgs.find((arg) =>
				arg.includes(":/workspace/out:rw"),
			);
			const outputDirectory = outputMount?.split(":/workspace/out:rw")[0];
			const writePromise =
				!isVersion && outputDirectory
					? fs.writeFile(path.join(outputDirectory, "gitleaks-output.json"), "[]")
					: Promise.resolve();
			return {
				exited: writePromise.then(() => 0),
				stdout: new Response(isVersion ? "8.30.1\n" : "").body,
				stderr: new Response("").body,
			} as any;
		});

		const result = await new GitleaksRunner(storage, {
			runner: "docker",
			docker: { image: "toolbox:test", networkMode: "none" },
		}).run("scan-diff", changedWorkspace, {
			preScoped: true,
			configPath,
		});

		expect(result.ok).toBe(true);
		expect(dockerArgs).toContain("/workspace/inputs/.gitleaks.toml");
		expect(
			dockerArgs.some((arg) => arg.endsWith(":/workspace/inputs/.gitleaks.toml:ro")),
		).toBe(true);
	});

	it("uses no-git for a pre-scoped diff workspace and normalizes paths", async () => {
		await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
		await fs.writeFile(path.join(tempDir, "src", "secret.ts"), "secret\n");
		let scanArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			if (args[0] === "gitleaks" && args[1] === "version") {
				return {
					exited: Promise.resolve(0),
					stdout: new Response("8.18.0\n").body,
					stderr: new Response("").body,
				} as any;
			}
			scanArgs = [...(args as string[])];
			const outputIdx = scanArgs.indexOf("--report-path");
			const writePromise = fs.writeFile(
				scanArgs[outputIdx + 1],
				JSON.stringify([
					{
						Description: "Secret",
						File: path.join(tempDir, "src", "secret.ts"),
						Secret: "redact-me",
						RuleID: "secret",
					},
				]),
			);
			return {
				exited: writePromise.then(() => 1),
				stdout: new Response("").body,
				stderr: new Response("").body,
			} as any;
		});

		const result = await new GitleaksRunner(storage).run(
			"scan-123",
			tempDir,
			{
				preScoped: true,
				normalizePathsRelativeTo: tempDir,
			},
		);

		expect(result.ok).toBe(true);
		expect(scanArgs).toContain("--no-git");
		expect(result.rawJson).toEqual([
			expect.objectContaining({
				File: "src/secret.ts",
				Secret: "[REDACTED]",
			}),
		]);
		const rawArtifact = await fs.readFile(
			path.join(artifactRoot, result.rawJsonArtifact?.path ?? ""),
			"utf8",
		);
		expect(rawArtifact).not.toContain(tempDir);
	});
});
