import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ProfileToolEntry } from "../../../shared/schemas/scan-profile.schema";
import { buildDiffScanPlan } from "./diff-scan-plan";
import { materializeDiffSnapshot } from "./diff-snapshot";
import { resolveGitDiff } from "./git-diff-resolver";
import { runGitText } from "./git-command";

const tools: ProfileToolEntry[] = [
	{
		toolId: "semgrep",
		displayName: "Semgrep",
		required: true,
		failurePolicy: "fail_profile",
	},
];

describe("diff snapshot", () => {
	let tempRoot: string;
	let repoPath: string;

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "diff-snapshot-test-"));
		repoPath = path.join(tempRoot, "repo");
		await fs.mkdir(repoPath);
		await git(["init", "-b", "main"]);
		await git(["config", "user.email", "test@example.com"]);
		await git(["config", "user.name", "Test User"]);
		await write("modified.txt", "base\n");
		await write("deleted.txt", "delete\n");
		await write("renamed.txt", "rename\n");
		await commit("base");
	});

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	it("materializes a committed target without changing the source checkout", async () => {
		const sigtermListeners = process.listenerCount("SIGTERM");
		const beforeBranch = (await git(["branch", "--show-current"])).trim();
		await write("modified.txt", "commit\n");
		await commit("change");
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: { kind: "commit", head: "HEAD" },
			}),
			tools,
		});

		const snapshot = await materializeDiffSnapshot({ plan });
		expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
		try {
			expect(
				await fs.readFile(path.join(snapshot.projectPath, "modified.txt"), "utf8"),
			).toBe("commit\n");
			expect(
				await fs.readFile(
					path.join(snapshot.changedWorkspacePath, "modified.txt"),
					"utf8",
				),
			).toBe("commit\n");
			expect(await git(["branch", "--show-current"])).toBe(
				`${beforeBranch}\n`,
			);
			expect(
				await fs
					.access(path.join(snapshot.rootPath, ".git"))
					.then(() => true)
					.catch(() => false),
			).toBe(false);
		} finally {
			await snapshot.cleanup();
		}
		expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
		expect(
			await fs
				.access(snapshot.rootPath)
				.then(() => true)
				.catch(() => false),
		).toBe(false);
	});

	it("overlays modified, untracked, deleted and renamed working-tree paths", async () => {
		await write("modified.txt", "working\n");
		await write("untracked.txt", "new\n");
		await fs.rm(path.join(repoPath, "deleted.txt"));
		await git(["mv", "renamed.txt", "new-name.txt"]);
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});

		const snapshot = await materializeDiffSnapshot({
			plan,
			expectedTargetDigest: plan.target.targetDigest,
		});
		try {
			expect(
				await fs.readFile(path.join(snapshot.projectPath, "modified.txt"), "utf8"),
			).toBe("working\n");
			expect(
				await fs.readFile(
					path.join(snapshot.projectPath, "untracked.txt"),
					"utf8",
				),
			).toBe("new\n");
			expect(
				await fs
					.access(path.join(snapshot.projectPath, "deleted.txt"))
					.then(() => true)
					.catch(() => false),
			).toBe(false);
			expect(
				await fs.readFile(path.join(snapshot.projectPath, "new-name.txt"), "utf8"),
			).toBe("rename\n");
			expect(snapshot.copiedChangedFiles).toBe(3);
		} finally {
			await snapshot.cleanup();
		}
	});

	it("rejects a stale expected target digest", async () => {
		await write("modified.txt", "working\n");
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});

		await expect(
			materializeDiffSnapshot({
				plan,
				expectedTargetDigest: "0".repeat(64),
			}),
		).rejects.toMatchObject({ code: "target_changed" });
	});

	it("adds unchanged dependency companions only to the Trivy workspace", async () => {
		await write("package.json", '{"dependencies":{"a":"1.0.0"}}\n');
		await write("package-lock.json", '{"lockfileVersion":3}\n');
		await commit("dependencies");
		await write("package.json", '{"dependencies":{"a":"2.0.0"}}\n');
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});

		const snapshot = await materializeDiffSnapshot({ plan });
		try {
			expect(snapshot.trivyContextFileCount).toBe(1);
			expect(
				await fs.readFile(
					path.join(snapshot.trivyWorkspacePath, "package-lock.json"),
					"utf8",
				),
			).toContain("lockfileVersion");
			expect(
				await fs
					.access(
						path.join(snapshot.changedWorkspacePath, "package-lock.json"),
					)
					.then(() => true)
					.catch(() => false),
			).toBe(false);
		} finally {
			await snapshot.cleanup();
		}
	});

	it("removes changed non-scannable paths from every scanner snapshot", async () => {
		await write("dist/generated.js", "base\n");
		await commit("excluded base");
		await write("dist/generated.js", "changed\n");
		await fs.symlink(
			".git/config",
			path.join(repoPath, "git-config-link"),
		);
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});

		expect(
			plan.manifest.entries.filter(
				(entry) => entry.disposition === "excluded",
			),
		).toHaveLength(2);
		const snapshot = await materializeDiffSnapshot({ plan });
		try {
			for (const relativePath of ["dist/generated.js", "git-config-link"]) {
				expect(
					await fs
						.access(path.join(snapshot.projectPath, relativePath))
						.then(() => true)
						.catch(() => false),
				).toBe(false);
				expect(
					await fs
						.access(path.join(snapshot.changedWorkspacePath, relativePath))
						.then(() => true)
						.catch(() => false),
				).toBe(false);
				expect(
					await fs
						.access(path.join(snapshot.trivyWorkspacePath, relativePath))
						.then(() => true)
						.catch(() => false),
				).toBe(false);
			}
		} finally {
			await snapshot.cleanup();
		}
	});

	it("rejects content mutation after planning", async () => {
		await write("modified.txt", "first\n");
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});
		await write("modified.txt", "second\n");

		await expect(materializeDiffSnapshot({ plan })).rejects.toMatchObject({
			code: "target_changed",
		});
	});

	it("materializes internal symlinks as verified regular scanner inputs", async () => {
		await write("linked-target.ts", "export const value = 1;\n");
		await commit("target");
		await fs.symlink(
			"linked-target.ts",
			path.join(repoPath, "linked-entry.ts"),
		);
		await commit("link");
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: { kind: "commit", head: "HEAD" },
			}),
			tools,
		});

		const snapshot = await materializeDiffSnapshot({ plan });
		try {
			const materializedPath = path.join(
				snapshot.projectPath,
				"linked-entry.ts",
			);
			expect((await fs.lstat(materializedPath)).isFile()).toBe(true);
			expect(await fs.readFile(materializedPath, "utf8")).toBe(
				"export const value = 1;\n",
			);
			expect(
				await fs.readFile(
					path.join(snapshot.changedWorkspacePath, "linked-entry.ts"),
					"utf8",
				),
			).toBe("export const value = 1;\n");
		} finally {
			await snapshot.cleanup();
		}
	});

	it("detects mutation of a working-tree symlink target after planning", async () => {
		await write("linked-target.ts", "first\n");
		await commit("target");
		await fs.symlink(
			"linked-target.ts",
			path.join(repoPath, "linked-entry.ts"),
		);
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});
		await write("linked-target.ts", "other\n");

		await expect(materializeDiffSnapshot({ plan })).rejects.toMatchObject({
			code: "target_changed",
		});
	});

	it("rejects launch when preview contains an unmerged path", async () => {
		await write("conflict.txt", "base\n");
		await commit("conflict base");
		await git(["checkout", "-b", "feature"]);
		await write("conflict.txt", "feature\n");
		await commit("feature");
		await git(["checkout", "main"]);
		await write("conflict.txt", "main\n");
		await commit("main");
		await expect(
			git(["merge", "feature", "-m", "conflict"]),
		).rejects.toBeDefined();
		const plan = buildDiffScanPlan({
			resolved: await resolveGitDiff({
				projectPath: repoPath,
				target: {
					kind: "working_tree",
					base: "HEAD",
					includeUntracked: true,
				},
			}),
			tools,
		});

		expect(plan.manifest.entries[0]?.status).toBe("unmerged");
		await expect(materializeDiffSnapshot({ plan })).rejects.toMatchObject({
			code: "unmerged_worktree",
		});
	});

	async function git(args: string[]): Promise<string> {
		return await runGitText({ cwd: repoPath, args });
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
