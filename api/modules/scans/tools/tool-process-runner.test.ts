import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createStaticScannerAdapterRegistry } from "../static-scanner-adapters";
import { cleanupDockerContainer } from "./docker-tool-cleanup";
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

async function waitForCondition(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (condition()) return;
		await Bun.sleep(1);
	}
	throw new Error("condition_not_reached");
}

beforeAll(() => {
	createStaticScannerAdapterRegistry({ optionalAdapterIds: ["semgrep"] });
});

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

	it("temporarily makes a private repository root readable by the fixed container uid", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-private-"));
		const repoPath = path.join(tempDir, "repo");
		await fs.mkdir(repoPath, { mode: 0o700 });
		await fs.chmod(repoPath, 0o700);
		let modeDuringExecution: number | null = null;

		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			const exited = fs.stat(repoPath).then((stat) => {
				modeDuringExecution = stat.mode & 0o777;
				return 0;
			});
			return {
				exited,
				stdout: streamText("[]"),
				stderr: streamText(""),
			} as any;
		});

		try {
			const result = await runToolProcess("semgrep", ["scan", "--json", repoPath], {
				repoPath,
				execution: { runner: "docker" },
			});

			expect(result).toMatchObject({ ok: true, exitCode: 0 });
			expect(modeDuringExecution).toBe(0o705);
			expect((await fs.stat(repoPath)).mode & 0o777).toBe(0o700);
			expect(result.executionMetadata?.docker).toMatchObject({
				repoDirectoryMode: { original: 0o700, execution: 0o705 },
			});
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps repository access until concurrent Docker scans release their leases", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docker-leases-"));
		const repoPath = path.join(tempDir, "repo");
		await fs.mkdir(repoPath, { mode: 0o700 });
		await fs.chmod(repoPath, 0o700);
		let releaseFirst: () => void = () => undefined;
		let releaseSecond: () => void = () => undefined;
		let spawnCount = 0;

		vi.spyOn(Bun, "spawn").mockImplementation(() => {
			spawnCount++;
			const exited = new Promise<number>((resolve) => {
				if (spawnCount === 1) releaseFirst = () => resolve(0);
				else releaseSecond = () => resolve(0);
			});
			return {
				exited,
				stdout: streamText("[]"),
				stderr: streamText(""),
			} as any;
		});

		try {
			const first = runToolProcess("semgrep", ["scan", "--json", repoPath], {
				repoPath,
				execution: { runner: "docker" },
			});
			await waitForCondition(() => spawnCount === 1);
			const second = runToolProcess("semgrep", ["scan", "--json", repoPath], {
				repoPath,
				execution: { runner: "docker" },
			});
			await waitForCondition(() => spawnCount === 2);

			releaseFirst();
			await first;
			expect((await fs.stat(repoPath)).mode & 0o777).toBe(0o705);
			releaseSecond();
			await second;
			expect((await fs.stat(repoPath)).mode & 0o777).toBe(0o700);
		} finally {
			releaseFirst();
			releaseSecond();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("permits only Trivy's ephemeral image cache to use its container root filesystem", async () => {
		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return {
				exited: Promise.resolve(0),
				stdout: streamText("Version: 0.72.0"),
				stderr: streamText(""),
			} as any;
		});
		await runToolProcess("trivy", ["--version"], {
			execution: { runner: "docker" },
		});
		expect(capturedArgs).not.toContain("--read-only");
		expect(capturedArgs).toContain("--user");
		expect(capturedArgs).toContain("65532:65532");
		expect(capturedArgs).toContain("--cap-drop");
		expect(capturedArgs).toContain("ALL");
	});

	it("does not rewrite scanner flags when the target is the current directory", async () => {
		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return {
				exited: Promise.resolve(0),
				stdout: streamText("[]"),
				stderr: streamText(""),
			} as any;
		});

		const repoPath = process.cwd();
		const result = await runToolProcess(
			"zizmor",
			["--offline", "--format=json-v1", repoPath],
			{
				repoPath,
				execution: { runner: "docker", docker: { networkMode: "none" } },
			},
		);

		expect(result).toMatchObject({ ok: true, exitCode: 0 });
		expect(capturedArgs).toContain("--offline");
		expect(capturedArgs).toContain("--format=json-v1");
		expect(capturedArgs).toContain("/workspace/repo");
		expect(capturedArgs).not.toContain("/workspace/repo/--offline");
	});

	it("runs Cosign attestation verification from the core toolbox without network access", async () => {
		const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "cosign-runner-"));
		const subjectPath = path.join(repoPath, "dist", "subject.bin");
		const bundlePath = path.join(repoPath, "attestations", "bundle.json");
		const keyPath = path.join(repoPath, "security", "cosign.pub");
		await Promise.all([
			fs.mkdir(path.dirname(subjectPath), { recursive: true }),
			fs.mkdir(path.dirname(bundlePath), { recursive: true }),
			fs.mkdir(path.dirname(keyPath), { recursive: true }),
		]);
		await Promise.all([
			fs.writeFile(subjectPath, "subject"),
			fs.writeFile(bundlePath, "{}"),
			fs.writeFile(keyPath, "public-key"),
		]);

		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return {
				exited: Promise.resolve(0),
				stdout: streamText("Verified OK"),
				stderr: streamText(""),
			} as any;
		});

		const result = await runToolProcess(
			"cosign",
			[
				"verify-blob-attestation",
				"--bundle",
				bundlePath,
				"--key",
				keyPath,
				subjectPath,
			],
			{
				repoPath,
				execution: {
					runner: "docker",
					docker: { image: "vuln-workbench-toolbox:test" },
				},
			},
		);

		expect(result).toMatchObject({ ok: true, exitCode: 0 });
		expect(capturedArgs).toContain("/usr/local/bin/cosign");
		expect(capturedArgs).toContain("none");
		expect(capturedArgs).toContain("--read-only");
		expect(capturedArgs).toContain(`${repoPath}:/workspace/repo:ro`);
		expect(capturedArgs).toContain("/workspace/repo/dist/subject.bin");
		expect(capturedArgs).toContain("/workspace/repo/attestations/bundle.json");
		expect(capturedArgs).toContain("/workspace/repo/security/cosign.pub");

		await fs.rm(repoPath, { recursive: true, force: true });
	});

	it("rejects Docker input files that would collide in the container", async () => {
		const firstDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-input-a-"));
		const secondDir = await fs.mkdtemp(path.join(os.tmpdir(), "tool-input-b-"));
		try {
			const first = path.join(firstDir, "image.tar");
			const second = path.join(secondDir, "image.tar");
			await fs.writeFile(first, "one");
			await fs.writeFile(second, "two");
			await expect(
				runToolProcess("trivy", ["image", "--input", first, second], {
					execution: { runner: "docker" },
					inputPaths: [first, second],
				}),
			).rejects.toThrow("Docker tool inputs must have unique filenames.");
		} finally {
			await fs.rm(firstDir, { recursive: true, force: true });
			await fs.rm(secondDir, { recursive: true, force: true });
		}
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

	it("joins only a lifecycle-owned runtime namespace without rewriting loopback to the host", async () => {
		let capturedArgs: string[] = [];
		vi.spyOn(Bun, "spawn").mockImplementation((args) => {
			capturedArgs = [...args];
			return { exited: Promise.resolve(0), stdout: streamText(""), stderr: streamText("") } as any;
		});
		const owner = "vwb-123e4567-e89b-12d3-a456-426614174000-owner";
		await runToolProcess("nuclei", ["-u", "http://127.0.0.1:18080", "-silent"], {
			execution: { runner: "docker", docker: { runtimeNamespaceOwnerId: owner } },
		});
		expect(capturedArgs).toContain(`container:${owner}`);
		expect(capturedArgs).toContain("http://127.0.0.1:18080");
		expect(capturedArgs).not.toContain("host.docker.internal");
	});

	it("runs the Schemathesis gateway from writable tmp on a read-only root", async () => {
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
			"vwb-schemathesis-readonly-gateway",
			[
				"run",
				"/workspace/inputs/policy.json",
				"--",
				"run",
				"/workspace/inputs/openapi.json",
				"--url",
				"http://127.0.0.1:18080",
			],
			{ execution: { runner: "docker" } },
		);

		expect(capturedArgs).toContain("--read-only");
		const workdirIndex = capturedArgs.indexOf("--workdir");
		expect(workdirIndex).toBeGreaterThan(-1);
		expect(capturedArgs[workdirIndex + 1]).toBe("/tmp");
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

	it("reports both non-zero and unavailable Docker cleanup attempts", async () => {
		const events: Array<{ eventType: string; data?: Record<string, unknown> }> =
			[];
		const emit = async (event: {
			eventType: string;
			data?: Record<string, unknown>;
		}) => {
			events.push(event);
		};
		vi.spyOn(Bun, "spawn").mockImplementationOnce(
			() =>
				({
					stdout: streamText(""),
					stderr: streamText("cleanup denied"),
					exited: Promise.resolve(1),
				}) as any,
		);
		await expect(
			cleanupDockerContainer("docker", "container-one", emit as never),
		).rejects.toThrow("docker_container_cleanup_failed");

		vi.spyOn(Bun, "spawn").mockImplementationOnce(() => {
			throw new Error("ENOENT");
		});
		await expect(
			cleanupDockerContainer("docker", "container-two", emit as never),
		).rejects.toThrow("docker_container_cleanup_failed");

		expect(events).toEqual([
			expect.objectContaining({
				eventType: "docker.container.cleanup_failed",
				data: expect.objectContaining({
					containerName: "container-one",
					exitCode: 1,
					stderr: "cleanup denied",
				}),
			}),
			expect.objectContaining({
				eventType: "docker.container.cleanup_failed",
				data: expect.objectContaining({
					containerName: "container-two",
					error: "ENOENT",
				}),
			}),
		]);
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
