import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	checkToolVersion,
	normalizeToolExecutionConfig,
	runToolProcess,
} from "./tool-process-runner";

function streamText(text: string) {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		},
	});
}

describe("Tool process runner Docker backend", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("builds a locked-down docker run invocation with read-only repo mount", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-runner-"));
		const repoPath = path.join(tempDir, "repo");
		const outDir = path.join(tempDir, "out");
		const cacheRoot = path.join(tempDir, "cache-root");
		const outputPath = path.join(outDir, "semgrep-output.json");
		await fs.mkdir(repoPath, { recursive: true });

		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return {
				exited: Promise.resolve(0),
				stdout: streamText("scan stdout"),
				stderr: streamText(""),
			} as any;
		});

		const events: string[] = [];
		const result = await runToolProcess(
			"semgrep",
			["scan", "--json", "--output", outputPath, repoPath],
			{
				timeoutSec: 30,
				repoPath,
				outputPath,
				execution: {
					runner: "docker",
					docker: {
						dockerBin: "docker",
						image: "vuln-workbench-toolbox:test",
						networkMode: "none",
						memory: "2g",
						cpus: "2",
						toolCacheDir: cacheRoot,
					},
				},
				onLifecycleEvent: (event) => {
					events.push(event.eventType);
				},
			},
		);

		expect(result.ok).toBe(true);
		expect(capturedArgs).toContain("run");
		expect(capturedArgs).toContain("--rm");
		expect(capturedArgs).toContain("--network");
		expect(capturedArgs).toContain("none");
		expect(capturedArgs).toContain("--user");
		expect(capturedArgs).toContain("65532:65532");
		expect(capturedArgs).toContain("--cap-drop");
		expect(capturedArgs).toContain("ALL");
		expect(capturedArgs).toContain("--read-only");
		expect(capturedArgs).toContain("--memory");
		expect(capturedArgs).toContain("--memory-swap");
		expect(capturedArgs).toContain("2g");
		expect(capturedArgs).toContain("--cpus");
		expect(capturedArgs).toContain("--pids-limit");
		expect(capturedArgs).toContain("512");
		expect(capturedArgs).toContain("--entrypoint");
		expect(capturedArgs).toContain("/usr/local/bin/semgrep");
		expect(capturedArgs).not.toContain("--privileged");
		expect(capturedArgs.join(" ")).not.toContain("/var/run/docker.sock");
		expect(capturedArgs).toContain(`${repoPath}:/workspace/repo:ro`);
		expect(capturedArgs).toContain(`${outDir}:/workspace/out:rw`);
		expect(capturedArgs).toContain(
			`${path.join(cacheRoot, "vuln-workbench-toolbox-cache")}:/workspace/cache:rw`,
		);
		expect(capturedArgs).toContain("/workspace/repo");
		expect(capturedArgs).toContain("/workspace/out/semgrep-output.json");
		expect(result.executionMetadata?.runner).toBe("docker");
		expect(events).toEqual([
			"docker.container.create",
			"docker.container.start",
			"docker.container.exit",
		]);

		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("does not let lifecycle observer failures interrupt a Docker tool", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.spyOn(Bun, "spawn").mockImplementation(
			() =>
				({
					exited: Promise.resolve(0),
					stdout: streamText("ok"),
					stderr: streamText(""),
				}) as any,
		);

		const result = await runToolProcess("semgrep", ["--version"], {
			execution: { runner: "docker" },
			onLifecycleEvent: () => {
				throw new Error("observer unavailable");
			},
		});

		expect(result).toMatchObject({ ok: true, exitCode: 0, stdout: "ok" });
	});

	it("rejects docker cache directories inside the target repository", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-runner-"));
		const repoPath = path.join(tempDir, "repo");
		const outputPath = path.join(tempDir, "out", "semgrep-output.json");
		await fs.mkdir(repoPath, { recursive: true });

		const spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("unexpected spawn");
		});

		const result = await runToolProcess(
			"semgrep",
			["scan", "--json", "--output", outputPath, repoPath],
			{
				repoPath,
				outputPath,
				execution: {
					runner: "docker",
					docker: {
						toolCacheDir: path.join(repoPath, ".cache"),
					},
				},
			},
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("must not be inside the target repository");
		expect(spawnSpy).not.toHaveBeenCalled();

		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("rejects non-allowlisted docker invocations", async () => {
		await expect(
			runToolProcess("bash", ["-lc", "env"], {
				execution: { runner: "docker" },
			}),
		).rejects.toThrow("Docker runner does not allow tool");
		await expect(
			runToolProcess("semgrep", [], {
				execution: { runner: "docker" },
			}),
		).rejects.toThrow("Docker runner does not allow semgrep invocation: (none)");
	});

	it("maps loopback runtime targets to Docker Desktop host access", async () => {
		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return {
				exited: Promise.resolve(0),
				stdout: streamText(""),
				stderr: streamText(""),
			} as any;
		});

		await runToolProcess(
			"nuclei",
			["-u", "http://127.0.0.1:4173", "-silent"],
			{
				execution: {
					runner: "docker",
					docker: { networkMode: "default" },
				},
			},
		);

		expect(capturedArgs).toContain("http://host.docker.internal:4173");
		expect(capturedArgs).not.toContain("http://127.0.0.1:4173");
	});

	it("fails docker version checks clearly when docker is unavailable", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			throw new Error("ENOENT");
		});

		await expect(
			checkToolVersion("semgrep", ["--version"], {
				execution: {
					runner: "docker",
					docker: { dockerBin: "/tmp/missing-docker" },
				},
			}),
		).rejects.toThrow("Docker process error: ENOENT");
	});

	it("accepts version output written to stderr", async () => {
		vi.spyOn(Bun, "spawn").mockImplementation(() => ({
			stdout: streamText(""),
			stderr: streamText("nuclei version 3.8.0"),
			exited: Promise.resolve(0),
		}) as any);
		expect(await checkToolVersion("nuclei", ["-version"])).toBe(
			"nuclei version 3.8.0",
		);
	});

	it("applies bounded default Docker resources", () => {
		expect(normalizeToolExecutionConfig({ runner: "docker" })).toMatchObject({
			docker: {
				memory: "4g",
				cpus: "2",
				pidsLimit: 512,
			},
		});
	});

	it("rejects Docker resource limits outside the supported safety range", () => {
		expect(() =>
			normalizeToolExecutionConfig({
				runner: "docker",
				docker: { memory: "16g" },
			}),
		).toThrow("between 512 MiB and 8 GiB");
		expect(() =>
			normalizeToolExecutionConfig({
				runner: "docker",
				docker: { cpus: "8" },
			}),
		).toThrow("between 0.25 and 4");
		expect(() =>
			normalizeToolExecutionConfig({
				runner: "docker",
				docker: { pidsLimit: 32 },
			}),
		).toThrow("between 64 and 1024");
	});

	it("terminates host tools when stdout exceeds the configured limit", async () => {
		const kill = vi.fn();
		vi.spyOn(Bun, "spawn").mockImplementation(
			() =>
				({
					stdout: streamText("12345"),
					stderr: streamText(""),
					exited: Promise.resolve(143),
					kill,
				}) as any,
		);

		const result = await runToolProcess("semgrep", ["--version"], {
			outputLimits: { stdoutBytes: 4, stderrBytes: 4 },
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain("tool_output_limit_exceeded");
		expect(result.stdout).toBe("1234");
		expect(kill).toHaveBeenCalledWith("SIGTERM");
		expect(result.executionMetadata?.outputCapture).toMatchObject({
			stdoutBytes: 5,
			terminationReason: "stdout_limit",
		});
	});

	it("rejects oversized structured output before a scanner parses it", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-output-"));
		const outputPath = path.join(tempDir, "result.json");
		await fs.writeFile(outputPath, "12345");
		vi.spyOn(Bun, "spawn").mockImplementation(
			() =>
				({
					stdout: streamText(""),
					stderr: streamText(""),
					exited: Promise.resolve(0),
				}) as any,
		);
		const events: string[] = [];

		const result = await runToolProcess("semgrep", ["--version"], {
			outputPath,
			outputLimits: { stdoutBytes: 4, stderrBytes: 4 },
			onLifecycleEvent: (event) => {
				events.push(event.eventType);
			},
		});

		expect(result.ok).toBe(false);
		expect(result.error).toContain("tool_output_limit_exceeded");
		expect(result.executionMetadata?.outputCapture).toMatchObject({
			outputFileBytes: 5,
			outputFileLimitBytes: 4,
			terminationReason: "output_file_limit",
		});
		expect(events).toEqual(["tool.output_file.limit_exceeded"]);
		await fs.rm(tempDir, { recursive: true, force: true });
	});
});
