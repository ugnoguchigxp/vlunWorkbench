import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { executeDynamicDockerRun } from "./dynamic-docker-executor";

describe("executeDynamicDockerRun cleanup", () => {
	test("does not expose unrelated application secrets to the Docker CLI", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-env-"));
		const dockerBin = path.join(root, "fake-docker");
		const outDir = path.join(root, "out");
		await fs.mkdir(outDir);
		await fs.writeFile(
			dockerBin,
			`#!/bin/sh
if [ -n "$OPENAI_API_KEY" ] || [ -n "$LLM_TOKEN" ]; then
  exit 77
fi
exit 0
`,
		);
		await fs.chmod(dockerBin, 0o755);
		const originalEnv = {
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
			LLM_TOKEN: process.env.LLM_TOKEN,
		};
		process.env.OPENAI_API_KEY = "openai-secret";
		process.env.LLM_TOKEN = "llm-secret";

		try {
			const result = await executeDynamicDockerRun({
				dockerBin,
				image: "example.invalid/dynamic@sha256:test",
				containerName: "dynamic-env-test",
				networkMode: "none",
				memory: "128m",
				cpus: "1",
				pidsLimit: 64,
				outputLimits: { stdoutBytes: 1024, stderrBytes: 1024 },
				repoPath: root,
				hostOutDir: outDir,
				workingDirectory: ".",
				command: ["true"],
				writableWorkdir: false,
				expectedArtifacts: [],
				timeoutSec: 1,
			});

			expect(result.ok).toBe(true);
			expect(result.exitCode).toBe(0);
		} finally {
			for (const [key, value] of Object.entries(originalEnv)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			await fs.rm(root, { recursive: true, force: true });
		}
	});

	test("returns an explicit failure when forced container removal fails", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "dynamic-cleanup-"));
		const dockerBin = path.join(root, "fake-docker");
		const outDir = path.join(root, "out");
		await fs.mkdir(outDir);
		await fs.writeFile(
			dockerBin,
			`#!/bin/sh
if [ "$1" = "rm" ]; then
  exit 9
fi
sleep 10
`,
		);
		await fs.chmod(dockerBin, 0o755);

		try {
			const result = await executeDynamicDockerRun({
				dockerBin,
				image: "example.invalid/dynamic@sha256:test",
				containerName: "dynamic-cleanup-test",
				networkMode: "none",
				memory: "128m",
				cpus: "1",
				pidsLimit: 64,
				outputLimits: { stdoutBytes: 32, stderrBytes: 32 },
				repoPath: root,
				hostOutDir: outDir,
				workingDirectory: ".",
				command: ["true"],
				writableWorkdir: false,
				expectedArtifacts: [],
				timeoutSec: 0.01,
			});

			expect(result).toMatchObject({
				ok: false,
				error: "dynamic_container_cleanup_failed",
				executionMetadata: { terminationReason: "cleanup_failed" },
			});
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
