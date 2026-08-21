import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTodolistSourceSnapshot,
  resolveTodolistAcceptanceTarget,
  selectTodolistAcceptanceProfiles,
} from "./todolist-scan-acceptance-lib";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("todolist scanner acceptance target", () => {
  it("uses the dedicated todolist repository and its fixed individual matrix", async () => {
    const target = await resolveTodolistAcceptanceTarget(
      path.resolve(process.cwd(), "..", "todolist"),
    );
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
      "sbom",
      "schemathesis-no-schema",
      "schemathesis-readonly",
      "passive-dast",
      "nuclei-safe",
      "zap-baseline",
      "trivy-image",
    ]);
  });

  it("rejects an unknown scanner selector instead of silently skipping it", () => {
    expect(() => selectTodolistAcceptanceProfiles(["unknown"])).toThrow(
      "todolist_acceptance_profile_unknown:unknown",
    );
  });

  it("accepts the target path only through the explicit environment contract", async () => {
    const original = process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH;
    process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH = path.resolve(
      process.cwd(),
      "..",
      "todolist",
    );
    try {
      expect((await resolveTodolistAcceptanceTarget()).repoPath).toContain(
        `${path.sep}todolist`,
      );
    } finally {
      if (original === undefined)
        delete process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH;
      else process.env.VULN_WORKBENCH_TODOLIST_REPO_PATH = original;
    }
  });

  it("creates a clean Git worktree at the pinned revision before scanners receive a source path", async () => {
    const target = await resolveTodolistAcceptanceTarget(
      path.resolve(process.cwd(), "..", "todolist"),
    );
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vwb-snapshot-test-"));
    temporaryRoots.push(root);
    const snapshot = await createTodolistSourceSnapshot(target, root);
    expect(snapshot.sourcePath).not.toBe(target.repoPath);
    expect(snapshot.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      fs.access(path.join(snapshot.sourcePath, "package.json")),
    ).resolves.toBeNull();
    await expect(fs.access(path.join(snapshot.sourcePath, ".git"))).resolves.toBeNull();
    const head = await fs.readFile(path.join(snapshot.sourcePath, ".git", "HEAD"), "utf8");
    expect(head.trim()).toBe(target.commit);
  });
});
