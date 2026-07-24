import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	authorizeProjectPath,
	canonicalizeProjectAllowedRoots,
	ProjectPathPolicyError,
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
		await fs.rm(temporaryRoot, { recursive: true, force: true });
	});

	it("allows a configured root and its descendants", async () => {
		await expect(
			authorizeProjectPath({
				projectPath: allowedRoot,
				allowedRoots: [allowedRoot],
			}),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(allowedRoot),
		});
		await expect(
			authorizeProjectPath({
				projectPath,
				allowedRoots: [allowedRoot],
			}),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(projectPath),
		});
	});

	it("does not confuse sibling path prefixes", async () => {
		const sibling = path.join(temporaryRoot, "repo-safe-evil");
		await fs.mkdir(sibling);
		await expect(
			authorizeProjectPath({
				projectPath: sibling,
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("rejects traversal outside an allowed root", async () => {
		await expect(
			authorizeProjectPath({
				projectPath: path.join(projectPath, "..", ".."),
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("rejects a symlink that resolves outside an allowed root", async () => {
		const outside = path.join(temporaryRoot, "outside");
		const link = path.join(allowedRoot, "linked-project");
		await fs.mkdir(outside);
		await fs.symlink(outside, link, "dir");
		await expect(
			authorizeProjectPath({
				projectPath: link,
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("rejects missing paths, files, and an empty allowed-root policy", async () => {
		const filePath = path.join(allowedRoot, "README.md");
		await fs.writeFile(filePath, "test");
		await expect(
			authorizeProjectPath({
				projectPath: path.join(allowedRoot, "missing"),
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_FOUND" });
		await expect(
			authorizeProjectPath({
				projectPath: filePath,
				allowedRoots: [allowedRoot],
			}),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_DIRECTORY" });
		await expect(
			authorizeProjectPath({ projectPath, allowedRoots: [] }),
		).rejects.toMatchObject({ code: "PROJECT_PATH_NOT_ALLOWED" });
	});

	it("supports multiple roots and canonicalizes duplicates", async () => {
		const secondRoot = path.join(temporaryRoot, "second-root");
		await fs.mkdir(secondRoot);
		await expect(
			authorizeProjectPath({
				projectPath: secondRoot,
				allowedRoots: [allowedRoot, secondRoot],
			}),
		).resolves.toMatchObject({
			canonicalPath: await fs.realpath(secondRoot),
		});
		await expect(
			canonicalizeProjectAllowedRoots([allowedRoot, allowedRoot]),
		).resolves.toEqual([await fs.realpath(allowedRoot)]);
	});

	it("fails closed when a configured root is invalid", async () => {
		await expect(
			canonicalizeProjectAllowedRoots([
				path.join(temporaryRoot, "missing-root"),
			]),
		).rejects.toBeInstanceOf(ProjectPathPolicyError);
	});
});
