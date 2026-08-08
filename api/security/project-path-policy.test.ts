import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	authorizeProjectPathWithinRoots,
	canonicalizeProjectAllowedRoots,
	ProjectPathPolicyError,
	resolveProjectPath,
} from "./project-path-policy";

describe("project path policy", () => {
	let temporaryRoot: string;
	let allowedRoot: string;
	let projectPath: string;

	beforeEach(async () => {
		temporaryRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "project-path-policy-"),
		);
		allowedRoot = path.join(temporaryRoot, "repo-safe");
		projectPath = path.join(allowedRoot, "project");
		await fs.mkdir(projectPath, { recursive: true });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.rm(temporaryRoot, { recursive: true, force: true });
	});

	it("resolves any existing readable directory", async () => {
		await expect(
			resolveProjectPath(allowedRoot),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(allowedRoot),
		});
		await expect(
			resolveProjectPath(projectPath),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(projectPath),
		});
	});

	it("allows sibling paths and traversal outside the startup directory", async () => {
		const sibling = path.join(temporaryRoot, "repo-safe-evil");
		await fs.mkdir(sibling);
		await expect(
			resolveProjectPath(sibling),
		).resolves.toMatchObject({ canonicalPath: await fs.realpath(sibling) });
		await expect(
			resolveProjectPath(path.join(projectPath, "..", "..")),
		).resolves.toMatchObject({ canonicalPath: await fs.realpath(temporaryRoot) });
	});

	it("accepts a readable directory reached through a symlink", async () => {
		const outside = path.join(temporaryRoot, "outside");
		const link = path.join(allowedRoot, "linked-project");
		await fs.mkdir(outside);
		await fs.symlink(outside, link, "dir");
		await expect(
			resolveProjectPath(link),
		).resolves.toMatchObject({ canonicalPath: await fs.realpath(outside) });
	});

	it("rejects missing paths and files", async () => {
		const filePath = path.join(allowedRoot, "README.md");
		await fs.writeFile(filePath, "test");
		await expect(
			resolveProjectPath(path.join(allowedRoot, "missing")),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_FOUND" });
		await expect(
			resolveProjectPath(filePath),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_DIRECTORY" });
	});

	it("distinguishes unreadable paths from missing paths", async () => {
		vi.spyOn(fs, "access").mockRejectedValueOnce(
			Object.assign(new Error("permission denied"), { code: "EACCES" }),
		);

		await expect(resolveProjectPath(projectPath)).rejects.toMatchObject({
			code: "PROJECT_PATH_UNREADABLE",
		});
	});

	it("rechecks that the canonical target is still a directory", async () => {
		const realStat = fs.stat.bind(fs);
		vi.spyOn(fs, "stat")
			.mockImplementationOnce(realStat)
			.mockResolvedValueOnce({ isDirectory: () => false } as never);

		await expect(resolveProjectPath(projectPath)).rejects.toMatchObject({
			code: "PROJECT_PATH_NOT_DIRECTORY",
		});
	});

	it("supports client-specific roots and canonicalizes duplicates", async () => {
		const secondRoot = path.join(temporaryRoot, "second-root");
		await fs.mkdir(secondRoot);
		await expect(
			authorizeProjectPathWithinRoots({
				projectPath: secondRoot,
				allowedRoots: [allowedRoot, secondRoot],
			}),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(secondRoot),
		});
		await expect(
			canonicalizeProjectAllowedRoots([allowedRoot, allowedRoot]),
		).resolves.toEqual([await fs.realpath(allowedRoot)]);
		await expect(
			authorizeProjectPathWithinRoots({
				projectPath: secondRoot,
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("fails closed when a configured root is invalid", async () => {
		await expect(
			canonicalizeProjectAllowedRoots([
				path.join(temporaryRoot, "missing-root"),
			]),
		).rejects.toBeInstanceOf(ProjectPathPolicyError);
	});
});
