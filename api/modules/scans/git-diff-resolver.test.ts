import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ScanScopePolicy } from "../../../shared/schemas/scan-profile.schema";
import { runGitText } from "./git-command";
import { resolveGitDiff } from "./git-diff-resolver";

const SOURCE_SCOPE: ScanScopePolicy = {
	intent: "source",
	includeGlobs: ["**/*"],
	excludeGlobs: ["dist/**", "node_modules/**"],
	includeGenerated: false,
	includeInstalledDependencies: false,
	includeVendoredDependencies: false,
};

describe("Git diff resolver", () => {
	let tempRoot: string;
	let repoPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "git-diff-resolver-"));
		repoPath = path.join(tempRoot, "repo");
		await fs.mkdir(repoPath);
		await git(["init", "-b", "main"]);
		await git(["config", "user.email", "test@example.com"]);
		await git(["config", "user.name", "Test User"]);
	});

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("resolves a single commit against its parent", async () => {
		await write("src/app.ts", "export const value = 1;\n");
		await commit("base");
		const baseSha = await rev("HEAD");
		await write("src/app.ts", "export const value = 2;\n");
		await write("src/new.ts", "export const added = true;\n");
		await commit("change");
		const headSha = await rev("HEAD");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: headSha },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.baseSha).toBe(baseSha);
		expect(resolved.headSha).toBe(headSha);
		expect(resolved.entries.map((entry) => [entry.status, entry.path])).toEqual([
			["modified", "src/app.ts"],
			["added", "src/new.ts"],
		]);
		expect(resolved.entries.every((entry) => entry.disposition === "scan")).toBe(
			true,
		);
	});

	it("uses the empty tree for a root commit", async () => {
		await write("root.ts", "export {};\n");
		await commit("root");
		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: "HEAD" },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toHaveLength(1);
		expect(resolved.entries[0]).toMatchObject({
			status: "added",
			path: "root.ts",
		});
		expect(resolved.baseSha).not.toBe(resolved.headSha);
	});

	it("uses merge-base semantics for a range", async () => {
		await write("base.txt", "base\n");
		await commit("base");
		const branchPoint = await rev("HEAD");
		await git(["checkout", "-b", "feature"]);
		await write("feature.txt", "feature\n");
		await commit("feature");
		const featureHead = await rev("HEAD");
		await git(["checkout", "main"]);
		await write("main.txt", "main\n");
		await commit("main");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "range", base: "main", head: featureHead },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.baseSha).toBe(branchPoint);
		expect(resolved.mergeBaseSha).toBe(branchPoint);
		expect(resolved.entries.map((entry) => entry.path)).toEqual([
			"feature.txt",
		]);
	});

	it("rejects an implicit parent for merge commits", async () => {
		await write("base.txt", "base\n");
		await commit("base");
		await git(["checkout", "-b", "feature"]);
		await write("feature.txt", "feature\n");
		await commit("feature");
		await git(["checkout", "main"]);
		await write("main.txt", "main\n");
		await commit("main");
		await git(["merge", "--no-ff", "feature", "-m", "merge"]);

		await expect(
			resolveGitDiff({
				projectPath: repoPath,
				target: { kind: "commit", head: "HEAD" },
				scope: SOURCE_SCOPE,
			}),
		).rejects.toMatchObject({
			code: "ambiguous_commit_parent",
		});
	});

	it("includes staged, unstaged and optional untracked working-tree files", async () => {
		await write("staged.txt", "base\n");
		await write("unstaged.txt", "base\n");
		await commit("base");
		await write("staged.txt", "staged\n");
		await git(["add", "staged.txt"]);
		await write("unstaged.txt", "unstaged\n");
		await write("untracked.txt", "untracked\n");
		await write("ignored.txt", "ignored\n");
		await write(".gitignore", "ignored.txt\n");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries.map((entry) => [entry.status, entry.path])).toEqual([
			["untracked", ".gitignore"],
			["modified", "staged.txt"],
			["modified", "unstaged.txt"],
			["untracked", "untracked.txt"],
		]);
		expect(resolved.entries.some((entry) => entry.path === "ignored.txt")).toBe(
			false,
		);
	});

	it("records rename, delete, scope exclusion, binary and symlink escape", async () => {
		await write("src/old.ts", "old\n");
		await write("src/deleted.ts", "delete\n");
		await commit("base");
		await git(["mv", "src/old.ts", "src/new.ts"]);
		await fs.rm(path.join(repoPath, "src/deleted.ts"));
		await write("dist/output.js", "generated\n");
		await fs.writeFile(path.join(repoPath, "binary.bin"), Buffer.from([0, 1, 2]));
		const externalPath = path.join(tempRoot, "external.txt");
		await fs.writeFile(externalPath, "outside\n");
		await fs.symlink(externalPath, path.join(repoPath, "escape.txt"));

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "renamed",
				oldPath: "src/old.ts",
				path: "src/new.ts",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "deleted",
				path: "src/deleted.ts",
				disposition: "deleted",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "dist/output.js",
				disposition: "excluded",
				reasonCode: "profile_excluded",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "binary.bin",
				binary: true,
				disposition: "unsupported",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "escape.txt",
				disposition: "unsupported",
				reasonCode: "symlink_escape",
			}),
		);
	});

	it("restricts paths to a nested project root", async () => {
		await write("packages/a/a.ts", "a\n");
		await write("packages/b/b.ts", "b\n");
		await commit("base");
		await write("packages/a/a.ts", "a2\n");
		await write("packages/b/b.ts", "b2\n");

		const resolved = await resolveGitDiff({
			projectPath: path.join(repoPath, "packages/a"),
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.projectPrefix).toBe("packages/a");
		expect(resolved.entries.map((entry) => entry.path)).toEqual(["a.ts"]);
	});

	it("treats nested project prefixes as literal pathspecs", async () => {
		const literalDirectory = "packages/:(glob)module*";
		await write(`${literalDirectory}/base.ts`, "base\n");
		await write("packages/other/other.ts", "other\n");
		await commit("base");
		await write(`${literalDirectory}/base.ts`, "changed\n");
		await write("packages/other/other.ts", "changed outside\n");

		const resolved = await resolveGitDiff({
			projectPath: path.join(repoPath, literalDirectory),
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries.map((entry) => entry.path)).toEqual(["base.ts"]);
	});

	it("represents renames crossing a nested project boundary as add/delete", async () => {
		await write("packages/in/move-out.ts", "out\n");
		await write("packages/out/move-in.ts", "in\n");
		await commit("base");
		await fs.rename(
			path.join(repoPath, "packages/in/move-out.ts"),
			path.join(repoPath, "packages/out/move-out.ts"),
		);
		await fs.rename(
			path.join(repoPath, "packages/out/move-in.ts"),
			path.join(repoPath, "packages/in/move-in.ts"),
		);
		await git(["add", "-A"]);

		const resolved = await resolveGitDiff({
			projectPath: path.join(repoPath, "packages/in"),
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "added",
				path: "move-in.ts",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "deleted",
				path: "move-out.ts",
			}),
		);
	});

	it("accepts valid paths whose first segment starts with two dots", async () => {
		await write("base.txt", "base\n");
		await commit("base");
		await write("..config/rule.ts", "export const enabled = true;\n");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "..config/rule.ts",
				disposition: "scan",
			}),
		);
	});

	it("returns deterministic ordering and content hashes", async () => {
		await write("z.txt", "z\n");
		await write("a.txt", "a\n");
		await commit("base");
		await write("z.txt", "z2\n");
		await write("a.txt", "a2\n");

		const first = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});
		const second = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(first.entries).toEqual(second.entries);
		expect(first.entries.map((entry) => entry.path)).toEqual([
			"a.txt",
			"z.txt",
		]);
		expect(first.entries.every((entry) => entry.contentSha256?.length === 64)).toBe(
			true,
		);
	});

	it("preserves paths containing newlines through NUL-delimited Git output", async () => {
		const unusualPath = "src/line\nbreak.ts";
		await write("base.txt", "base\n");
		await commit("base");
		await write(unusualPath, "export const unusual = true;\n");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "untracked",
				path: unusualPath,
				disposition: "scan",
			}),
		);
	});

	it("records committed copies and gitlinks explicitly", async () => {
		await write("source.txt", "shared content\n");
		await commit("base");
		const baseSha = await rev("HEAD");
		await write("copied.txt", "shared content\n");
		await git([
			"update-index",
			"--add",
			"--cacheinfo",
			`160000,${baseSha},vendor/submodule`,
		]);
		await git(["add", "copied.txt"]);
		await git(["commit", "-m", "copy and gitlink"]);

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: "HEAD" },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "copied",
				oldPath: "source.txt",
				path: "copied.txt",
				disposition: "scan",
			}),
		);
		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "gitlink",
				path: "vendor/submodule",
				disposition: "unsupported",
				reasonCode: "gitlink_not_materialized",
			}),
		);
	});

	it("exposes an unmerged path for preview instead of scanning it", async () => {
		await write("conflict.txt", "base\n");
		await commit("base");
		await git(["checkout", "-b", "feature"]);
		await write("conflict.txt", "feature\n");
		await commit("feature");
		await git(["checkout", "main"]);
		await write("conflict.txt", "main\n");
		await commit("main");
		await expect(
			git(["merge", "feature", "-m", "conflict"]),
		).rejects.toBeDefined();

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				status: "unmerged",
				path: "conflict.txt",
				disposition: "unsupported",
			}),
		);
	});

	it("marks an escaping committed symlink as unsupported", async () => {
		await write("base.txt", "base\n");
		await commit("base");
		const externalPath = path.join(tempRoot, "outside.txt");
		await fs.writeFile(externalPath, "outside\n");
		await fs.symlink(externalPath, path.join(repoPath, "escape.txt"));
		await commit("symlink");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: "HEAD" },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "escape.txt",
				disposition: "unsupported",
				reasonCode: "symlink_escape",
			}),
		);
	});

	it("hashes the bytes scanned through an internal committed symlink", async () => {
		const targetContent = "export const linked = true;\n";
		await write("src/target.ts", targetContent);
		await commit("base");
		await fs.symlink("target.ts", path.join(repoPath, "src/link.ts"));
		await commit("internal symlink");

		const resolved = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: "HEAD" },
			scope: SOURCE_SCOPE,
		});

		expect(resolved.entries).toContainEqual(
			expect.objectContaining({
				path: "src/link.ts",
				disposition: "scan",
				sizeBytes: Buffer.byteLength(targetContent),
				contentSha256: crypto
					.createHash("sha256")
					.update(targetContent)
					.digest("hex"),
			}),
		);
	});

	it("does not let symlinks bypass mandatory or profile exclusions", async () => {
		await write("dist/generated.js", "generated\n");
		await commit("excluded target");
		await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
		await fs.symlink(
			"../dist/generated.js",
			path.join(repoPath, "src/generated-link.js"),
		);
		await commit("committed link");

		const committed = await resolveGitDiff({
			projectPath: repoPath,
			target: { kind: "commit", head: "HEAD" },
			scope: SOURCE_SCOPE,
		});
		expect(committed.entries).toContainEqual(
			expect.objectContaining({
				path: "src/generated-link.js",
				disposition: "excluded",
				reasonCode: "profile_excluded",
			}),
		);

		await fs.symlink(
			".git/config",
			path.join(repoPath, "git-config-link"),
		);
		const workingTree = await resolveGitDiff({
			projectPath: repoPath,
			target: {
				kind: "working_tree",
				base: "HEAD",
				includeUntracked: true,
			},
			scope: SOURCE_SCOPE,
		});
		expect(workingTree.entries).toContainEqual(
			expect.objectContaining({
				path: "git-config-link",
				disposition: "excluded",
				reasonCode: "profile_excluded",
			}),
		);
	});

	it("rejects using the Git administrative directory as a project root", async () => {
		await write("base.txt", "base\n");
		await commit("base");

		await expect(
			resolveGitDiff({
				projectPath: path.join(repoPath, ".git"),
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
				scope: SOURCE_SCOPE,
			}),
		).rejects.toMatchObject({ code: "not_a_git_repository" });
	});

	async function git(args: string[]): Promise<string> {
		return await runGitText({ cwd: repoPath, args });
	}

	async function rev(ref: string): Promise<string> {
		return (await git(["rev-parse", ref])).trim();
	}

	async function write(relativePath: string, content: string): Promise<void> {
		const absolutePath = path.join(repoPath, relativePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content);
	}

	async function commit(message: string): Promise<void> {
		await git(["add", "-A"]);
		await git(["commit", "-m", message]);
	}
});
