import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { ARTIFACT_SCOPE } from "../profiles";
import { runGitCommand } from "./diff/git-command";
import { resolveFullScanTarget } from "./full-scan-target";

describe("resolveFullScanTarget", () => {
	const roots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			roots.splice(0).map((root) =>
				fs.rm(root, { recursive: true, force: true }),
			),
		);
	});

	it("binds ignored artifact output into a full artifact target", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "vwb-full-artifact-target-"),
		);
		roots.push(repositoryPath);
		await runGitCommand({ cwd: repositoryPath, args: ["init"] });
		await runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.email", "test@example.invalid"],
		});
		await runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.name", "Test"],
		});
		await fs.writeFile(path.join(repositoryPath, ".gitignore"), "dist/\n");
		await fs.writeFile(path.join(repositoryPath, "app.ts"), "export {};\n");
		await fs.mkdir(path.join(repositoryPath, "dist"));
		await fs.writeFile(path.join(repositoryPath, "dist", "app.js"), "v1");
		await runGitCommand({ cwd: repositoryPath, args: ["add", "."] });
		await runGitCommand({ cwd: repositoryPath, args: ["commit", "-m", "base"] });

		const first = await resolveFullScanTarget(repositoryPath, ARTIFACT_SCOPE);
		await fs.writeFile(path.join(repositoryPath, "dist", "app.js"), "v2");
		const second = await resolveFullScanTarget(repositoryPath, ARTIFACT_SCOPE);

		expect(first.sourceRevision).toBe(second.sourceRevision);
		expect(first.scopeContentDigest).not.toBeNull();
		expect(first.scopeContentDigest).not.toBe(second.scopeContentDigest);
		expect(first.digest).not.toBe(second.digest);
	});

	it("binds uncommitted in-scope source content into a full source target", async () => {
		const repositoryPath = await fs.mkdtemp(
			path.join(os.tmpdir(), "vwb-full-source-target-"),
		);
		roots.push(repositoryPath);
		await runGitCommand({ cwd: repositoryPath, args: ["init"] });
		await runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.email", "test@example.invalid"],
		});
		await runGitCommand({
			cwd: repositoryPath,
			args: ["config", "user.name", "Test"],
		});
		await fs.writeFile(path.join(repositoryPath, "app.ts"), "v1");
		await runGitCommand({ cwd: repositoryPath, args: ["add", "."] });
		await runGitCommand({ cwd: repositoryPath, args: ["commit", "-m", "base"] });

		const first = await resolveFullScanTarget(repositoryPath);
		await fs.writeFile(path.join(repositoryPath, "app.ts"), "v2");
		const second = await resolveFullScanTarget(repositoryPath);

		expect(first.sourceRevision).toBe(second.sourceRevision);
		expect(first.scopeContentDigest).not.toBe(second.scopeContentDigest);
		expect(first.digest).not.toBe(second.digest);
	});
});
