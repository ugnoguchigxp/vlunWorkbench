import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGitCommand } from "../diff/git-command";
import {
	materializeFullSourceSnapshot,
	materializeScopedSourceSnapshot,
} from "./full-source-snapshot";
import { ARTIFACT_SCOPE } from "../../profiles";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("full source snapshot", () => {
	it("checks out a fixed revision without exposing .git or later working-tree changes", async () => {
		const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-source-test-"));
		roots.push(repositoryPath);
		await runGitCommand({ cwd: repositoryPath, args: ["init"] });
		await runGitCommand({ cwd: repositoryPath, args: ["config", "user.email", "test@example.invalid"] });
		await runGitCommand({ cwd: repositoryPath, args: ["config", "user.name", "Test"] });
		await fs.writeFile(path.join(repositoryPath, "app.txt"), "immutable\n");
		await runGitCommand({ cwd: repositoryPath, args: ["add", "app.txt"] });
		await runGitCommand({ cwd: repositoryPath, args: ["commit", "-m", "initial"] });
		const revision = (await runGitCommand({ cwd: repositoryPath, args: ["rev-parse", "HEAD"] })).stdout.toString().trim();
		await fs.writeFile(path.join(repositoryPath, "app.txt"), "mutable\n");

		const snapshot = await materializeFullSourceSnapshot({ repositoryPath, sourceRevision: revision });
		try {
			expect(await fs.readFile(path.join(snapshot.projectPath, "app.txt"), "utf8")).toBe("immutable\n");
			await expect(fs.stat(path.join(snapshot.projectPath, ".git"))).rejects.toThrow();
			expect(snapshot.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);
		} finally {
			await snapshot.cleanup();
		}
		await expect(fs.stat(snapshot.rootPath)).rejects.toThrow();
	});

	it("materializes ignored build output for an artifact scan", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "vwb-artifact-source-test-"),
		);
		roots.push(repositoryPath);
		const sourceRevision = "a".repeat(40);
		await fs.writeFile(path.join(repositoryPath, "tracked.txt"), "source");
		await fs.mkdir(path.join(repositoryPath, "dist"));
		await fs.writeFile(path.join(repositoryPath, "dist", "bundle.js"), "bundle");
		const snapshot = await materializeScopedSourceSnapshot({
			repositoryPath,
			sourceRevision,
			scope: ARTIFACT_SCOPE,
		});
		try {
			await expect(
				fs.readFile(path.join(snapshot.projectPath, "dist", "bundle.js"), "utf8"),
			).resolves.toBe("bundle");
			await expect(
				fs.stat(path.join(snapshot.projectPath, "tracked.txt")),
			).rejects.toThrow();
		} finally {
			await snapshot.cleanup();
		}
	});
});
