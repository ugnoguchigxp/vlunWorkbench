import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPageDiff } from "./content-git-repo";

const execFileAsync = promisify(execFile);

describe("content Git repository", () => {
	let contentRoot: string;
	let firstCommit: string;
	let secondCommit: string;

	beforeEach(async () => {
		contentRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-git-repo-"));
		await fs.mkdir(path.join(contentRoot, "pages", "guide"), { recursive: true });
		await execFileAsync("git", ["-C", contentRoot, "init", "-q"]);
		await execFileAsync("git", [
			"-C",
			contentRoot,
			"config",
			"user.email",
			"test@example.com",
		]);
		await execFileAsync("git", [
			"-C",
			contentRoot,
			"config",
			"user.name",
			"Test User",
		]);
		await fs.writeFile(
			path.join(contentRoot, "pages", "guide", "index.md"),
			"first\n",
		);
		await execFileAsync("git", ["-C", contentRoot, "add", "."]);
		await execFileAsync("git", ["-C", contentRoot, "commit", "-qm", "first"]);
		firstCommit = (
			await execFileAsync("git", ["-C", contentRoot, "rev-parse", "HEAD"])
		).stdout.trim();
		await fs.writeFile(
			path.join(contentRoot, "pages", "guide", "index.md"),
			"first\nsecond\n",
		);
		await execFileAsync("git", ["-C", contentRoot, "add", "."]);
		await execFileAsync("git", ["-C", contentRoot, "commit", "-qm", "second"]);
		secondCommit = (
			await execFileAsync("git", ["-C", contentRoot, "rev-parse", "HEAD"])
		).stdout.trim();
	});

	afterEach(async () => {
		await fs.rm(contentRoot, { recursive: true, force: true });
	});

	it("returns a page diff for full Git object IDs", async () => {
		const diff = await getPageDiff(contentRoot, "guide", firstCommit, secondCommit);
		expect(diff).toContain("+second");
	});

	it("rejects option-like revisions before invoking Git", async () => {
		const outputPath = path.join(contentRoot, "injected.diff");
		await expect(
			getPageDiff(
				contentRoot,
				"guide",
				`--output=${outputPath}`,
				secondCommit,
			),
		).rejects.toThrow("Invalid Git object ID");
		await expect(fs.stat(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
