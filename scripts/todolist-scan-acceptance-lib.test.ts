import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTodolistSourceSnapshot,
  resolveTodolistAcceptanceTarget,
  selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

describe("todolist scanner acceptance target", () => {
  it("uses the dedicated todolist repository and its fixed individual matrix", async () => {
    await withTodolistTarget(async ({ repoPath, contractPath }) => {
      const target = await resolveTodolistAcceptanceTarget(repoPath, {
        contractPath,
      });
      expect(target.repoPath).toContain(`${path.sep}todolist`);
      expect(typeof target.commit).toBe("string");
      expect(
        selectTodolistAcceptanceProfiles([]).map((profile) => profile.id),
      ).toEqual([
        "gitleaks",
        "osv",
        "osv-installed-tree",
        "trivy-fs",
        "semgrep",
        "zizmor",
        "sbom",
        "schemathesis-no-schema",
        "schemathesis-readonly",
        "passive-dast",
        "nuclei-safe",
        "zap-baseline",
        "trivy-image",
      ]);
    });
  });

  it("rejects an unknown scanner selector instead of silently skipping it", () => {
    expect(() => selectTodolistAcceptanceProfiles(["unknown"])).toThrow(
      "todolist_acceptance_profile_unknown:unknown",
    );
  });

  it("accepts the target path only through the explicit environment contract", async () => {
    await withTodolistTarget(async ({ repoPath, contractPath }) => {
      const original = process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH;
      process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH = repoPath;
      try {
        expect(
          (
            await resolveTodolistAcceptanceTarget(undefined, { contractPath })
          ).repoPath,
        ).toContain(`${path.sep}todolist`);
      } finally {
        if (original === undefined)
          delete process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH;
        else process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH = original;
      }
    });
  });

  it("creates a clean Git worktree at the pinned revision before scanners receive a source path", async () => {
    await withTodolistTarget(async ({ repoPath, contractPath }) => {
      const target = await resolveTodolistAcceptanceTarget(repoPath, {
        contractPath,
      });
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-snapshot-test-"));
      try {
        const snapshot = await createTodolistSourceSnapshot(target, root);
        expect(snapshot.sourcePath).not.toBe(target.repoPath);
        expect(snapshot.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
        await expect(
          fs.access(path.join(snapshot.sourcePath, "package.json")),
        ).resolves.toBeNull();
        await expect(
          fs.access(path.join(snapshot.sourcePath, ".git")),
        ).resolves.toBeNull();
        const head = await fs.readFile(
          path.join(snapshot.sourcePath, ".git", "HEAD"),
          "utf8",
        );
        expect(head.trim()).toBe(target.commit);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  });
});

async function withTodolistTarget(
  run: (fixture: { repoPath: string; contractPath: string }) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-todolist-target-"));
  const repoPath = path.join(root, "todolist");
  const contractPath = path.join(root, "target-contract.json");
  try {
    await fs.mkdir(repoPath);
    await Promise.all([
      fs.writeFile(
        path.join(repoPath, "package.json"),
        '{"name":"todolist","private":true}\n',
      ),
      fs.writeFile(path.join(repoPath, "Dockerfile"), "FROM scratch\n"),
    ]);
    runGit(repoPath, ["init", "--object-format=sha1"]);
    runGit(repoPath, ["config", "user.email", "test@example.com"]);
    runGit(repoPath, ["config", "user.name", "Test"]);
    runGit(repoPath, ["add", "package.json", "Dockerfile"]);
    runGit(repoPath, ["commit", "-m", "fixture"]);
    const commit = runGit(repoPath, ["rev-parse", "HEAD"]);
    expect(commit).toMatch(/^[a-f0-9]{40}$/);
    await fs.writeFile(
      contractPath,
      `${JSON.stringify({ schemaVersion: 1, repository: "todolist", commit })}\n`,
    );
    await run({ repoPath, contractPath });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function runGit(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
