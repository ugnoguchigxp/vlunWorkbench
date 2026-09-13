import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as gitCommand from "../scans/execution/diff/git-command";
import { resolveImmutableHead } from "./dynamic-source-revision";

describe("resolveImmutableHead", () => {
	const roots: string[] = [];

	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
		);
	});

	it("returns the immutable HEAD revision for a git repository", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "dynamic-source-revision-"),
		);
		roots.push(repositoryPath);
		await gitCommand.runGitCommand({ cwd: repositoryPath, args: ["init"] });
		await gitCommand.runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.email", "test@example.invalid"],
		});
		await gitCommand.runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.name", "Test"],
		});
		await fs.writeFile(path.join(repositoryPath, "app.ts"), "export {};\n");
		await gitCommand.runGitCommand({ cwd: repositoryPath, args: ["add", "."] });
		await gitCommand.runGitCommand({
			cwd: repositoryPath,
			args: ["commit", "-m", "base"],
		});
		const revision = await resolveImmutableHead(repositoryPath);
		expect(revision).toMatch(/^[a-f0-9]{40,64}$/i);
	});

	it("rejects a non-commit git output", async () => {
		vi.spyOn(gitCommand, "runGitCommand").mockResolvedValue({
			stdout: Buffer.from("not-a-revision\n"),
			stderr: "",
			exitCode: 0,
		});
		await expect(resolveImmutableHead("/tmp/repo")).rejects.toThrow(
			"dynamic_source_revision_invalid",
		);
	});
});
