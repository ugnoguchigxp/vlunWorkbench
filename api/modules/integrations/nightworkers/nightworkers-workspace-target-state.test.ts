import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { withProjectPathRoots } from "../../../security/configured-project-path";
import { captureWorkspaceTargetState } from "./nightworkers-workspace-target-state";

const exec = promisify(execFile);
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]) {
  await exec("git", ["-C", cwd, ...args]);
}

async function repository(parent: string, name: string) {
  const repo = path.join(parent, name);
  await fs.mkdir(repo, { recursive: true });
  await git(repo, "init");
  await git(repo, "config", "user.email", "fixture@example.com");
  await git(repo, "config", "user.name", "Fixture");
  await fs.writeFile(path.join(repo, "README.md"), "initial\n", "utf8");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-m", "initial");
  return repo;
}

function capture(workspacePath: string, allowedRoots: readonly string[]) {
  return withProjectPathRoots(allowedRoots, () =>
    captureWorkspaceTargetState({ workspacePath, allowedRoots }),
  );
}

describe("captureWorkspaceTargetState", () => {
  it("binds a linked worktree to the same common directory and observes drift", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vw-workspace-grant-"));
    cleanup.push(root);
    const repo = await repository(root, "repo");
    const worktree = path.join(root, "worktree");
    await git(repo, "worktree", "add", "--detach", worktree);

    const registered = await capture(repo, [root]);
    const before = await capture(worktree, [root]);
    expect(before.gitCommonDirDigest).toBe(registered.gitCommonDirDigest);
    expect(before.headSha).toBe(registered.headSha);

    await fs.writeFile(path.join(worktree, "README.md"), "changed\n", "utf8");
    const after = await capture(worktree, [root]);
    expect(after.workspaceStateDigest).not.toBe(before.workspaceStateDigest);
    expect(after.targetDigest).not.toBe(before.targetDigest);
  }, 30_000);

  it("distinguishes another repository and rejects a symlink escape", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vw-workspace-grant-"));
    cleanup.push(root);
    const first = await repository(root, "first");
    const second = await repository(root, "second");
    const firstState = await capture(first, [root]);
    const secondState = await capture(second, [root]);
    expect(secondState.gitCommonDirDigest).not.toBe(firstState.gitCommonDirDigest);

    const allowed = path.join(root, "allowed");
    await fs.mkdir(allowed);
    const link = path.join(allowed, "escaped");
    await fs.symlink(second, link);
    await expect(capture(link, [allowed])).rejects.toMatchObject({
      code: "project_path_denied",
    });
  }, 30_000);
});
