import { execFileSync, execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
  findings,
  projects,
  scanArtifacts,
  scanEvents,
  scanReports,
  scanRuns,
  toolRuns,
  users,
} from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import * as profileRunnerModule from "./profile-runner";
import { runProfileScan } from "./profile-runner";

describe("Profile Runner Orchestration", () => {
  let tempDir: string;
  let dbFile: string;
  let dbUrl: string;
  let connection: DbConnection;
  let userId: string;
  let projectId: string;
  let repoPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-runner-test-"));
    dbFile = path.join(tempDir, "test.sqlite");
    dbUrl = `file:${dbFile}`;
    repoPath = path.join(tempDir, "repo");

    await fs.mkdir(repoPath, { recursive: true });

    // Run migrations on the test database
    execSync("bun run db:migrate", {
      env: { ...process.env, DATABASE_URL: dbUrl },
    });

    connection = createDbConnection(dbUrl);

    // Seed a test user
    const now = new Date();
    const [user] = await connection.db
      .insert(users)
      .values({
        email: "profile-test@example.com",
        passwordHash: "hash",
        displayName: "Profile Test User",
        role: "member",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    userId = user.id;

    // Seed a project
    const [project] = await connection.db
      .insert(projects)
      .values({
        ownerUserId: userId,
        name: "Profile Test Project",
        repoPath,
        defaultBranch: "main",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    projectId = project.id;
  });

  afterEach(async () => {
    if (connection) {
      await closeTestDbConnection(connection);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should run profile scan successfully when all tools succeed", async () => {
    const spy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockImplementation(async (params) => {
        return {
          toolRunId: "tool-run-123",
          findingCount: 3,
          exitCode: 0,
          elapsedMs: 120,
          artifactIds: ["art-1"],
          diffUnmappedFindingCount: 0,
        };
      });

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "baseline",
      repoPath,
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.profileOutcome).toBe("completed");
    expect(result.toolResults).toHaveLength(2); // gitleaks, osv
    expect(result.toolResults[0].status).toBe("completed");
    expect(result.toolResults[0].findingCount).toBe(3);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: "gitleaks",
        options: expect.objectContaining({
          scope: expect.objectContaining({
            intent: "source",
            includeInstalledDependencies: false,
          }),
          scopeSummary: expect.objectContaining({
            excludedRoots: expect.arrayContaining(["node_modules", "dist"]),
          }),
        }),
      }),
    );

    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          scope: expect.objectContaining({ intent: "source" }),
        }),
      }),
    );
  });

  it("fails before starting any scanner when enforced required preflight is blocked", async () => {
    const scannerSpy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockResolvedValue({
        toolRunId: "must-not-run",
        findingCount: 0,
        exitCode: 0,
        elapsedMs: 1,
        artifactIds: [],
        diffUnmappedFindingCount: 0,
      });
    const previousManifest = process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST;
    process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST = path.join(
      tempDir,
      "missing-scanner-data-manifest.json",
    );
    let result: Awaited<ReturnType<typeof runProfileScan>>;
    try {
      result = await runProfileScan({
        db: connection.db,
        projectId,
        profileId: "baseline",
        repoPath,
        preflightMode: "enforced",
      });
    } finally {
      if (previousManifest === undefined) {
        delete process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST;
      } else {
        process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST = previousManifest;
      }
    }
    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      profileOutcome: "blocked",
      toolResults: [],
      stepResults: [],
    });
    expect(scannerSpy).not.toHaveBeenCalled();
    expect(
      await connection.db
        .select()
        .from(toolRuns)
        .where(eq(toolRuns.scanRunId, result.scanRunId)),
    ).toHaveLength(0);
    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        terminationReason: "preflight_failed",
        scanPreflight: expect.objectContaining({
          schemaVersion: 1,
          mode: "enforced",
          status: "blocked",
          limitationCodes: expect.arrayContaining([
            "scanner_data_manifest_invalid",
          ]),
        }),
      }),
    );
  });

  it("fails before starting a scanner when the preflight binding changed", async () => {
    const scannerSpy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockRejectedValue(new Error("must not run"));
    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "baseline",
      repoPath,
      expectedPreflightBindingHash: `sha256:${"0".repeat(64)}`,
    });
    expect(result).toMatchObject({
      ok: false,
      status: "failed",
      profileOutcome: "blocked",
      toolResults: [],
      stepResults: [],
    });
    expect(scannerSpy).not.toHaveBeenCalled();
    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        terminationReason: "preflight_changed",
        preflightBindingHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
  });

  it("skips only an optional step blocked by enforced preflight", async () => {
    const mockProfile = {
      id: "optional-preflight",
      name: "Optional preflight",
      description: "Optional scanner preflight",
      category: "focused" as const,
      enabled: true,
      defaultTimeoutSec: 60,
      tools: [
        {
          toolId: "osv",
          displayName: "OSV",
          required: false,
          failurePolicy: "warn_and_continue" as const,
        },
      ],
    };
    vi.spyOn(require("./profiles"), "getProfileById").mockReturnValue(
      mockProfile,
    );
    const scannerSpy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockRejectedValue(new Error("must not run"));
    const previousManifest = process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST;
    process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST = path.join(
      tempDir,
      "missing-optional-manifest.json",
    );
    let result: Awaited<ReturnType<typeof runProfileScan>>;
    try {
      result = await runProfileScan({
        db: connection.db,
        projectId,
        profileId: mockProfile.id,
        repoPath,
        preflightMode: "enforced",
      });
    } finally {
      if (previousManifest === undefined) {
        delete process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST;
      } else {
        process.env.VULN_WORKBENCH_SCANNER_DATA_MANIFEST = previousManifest;
      }
    }
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      profileOutcome: "completed_with_warnings",
      toolResults: [
        expect.objectContaining({
          toolId: "osv",
          status: "skipped",
          reasonCode: "preflight_failed",
          coverageEffect: "gap",
        }),
      ],
    });
    expect(scannerSpy).not.toHaveBeenCalled();
    expect(
      await connection.db
        .select()
        .from(toolRuns)
        .where(eq(toolRuns.scanRunId, result.scanRunId)),
    ).toHaveLength(0);
  });

  it("runs a working-tree diff profile with immutable scanner inputs", async () => {
    execFileSync("git", ["init", "-b", "main"], { cwd: repoPath });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoPath,
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: repoPath,
    });
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, "src/app.ts"),
      "export const a = 1;\n",
    );
    execFileSync("git", ["add", "-A"], { cwd: repoPath });
    execFileSync("git", ["commit", "-m", "base"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "src/app.ts"),
      "export const a = 2;\n",
    );

    const spy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockImplementation(async () => ({
        toolRunId: randomUUID(),
        findingCount: 0,
        exitCode: 0,
        elapsedMs: 10,
        artifactIds: [],
        diffUnmappedFindingCount: 0,
      }));

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "diff-source-baseline",
      repoPath,
      target: {
        kind: "working_tree",
        base: "HEAD",
        includeUntracked: true,
      },
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(true);
    expect(result.profileOutcome).toBe("completed");
    expect(result.toolResults).toHaveLength(3);
    expect(
      result.toolResults.find((tool) => tool.toolId === "osv"),
    ).toMatchObject({
      status: "skipped",
      applicability: "not_applicable",
      reasonCode: "no_dependency_manifest_changed",
    });
    expect(spy).toHaveBeenCalledTimes(2);
    const gitleaksCall = spy.mock.calls.find(
      ([params]) => params.toolId === "gitleaks",
    )?.[0];
    expect(gitleaksCall?.diffContext?.inputKind).toBe("changed_workspace");

    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        target: expect.objectContaining({
          kind: "working_tree",
          targetDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        diffCoverage: expect.objectContaining({
          changed: 1,
          scannable: 1,
        }),
        diffManifestArtifactId: expect.any(String),
      }),
    );
    const manifests = await connection.db
      .select()
      .from(scanArtifacts)
      .where(eq(scanArtifacts.scanRunId, result.scanRunId));
    expect(manifests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "diff_manifest", toolRunId: null }),
      ]),
    );
    expect(
      execFileSync("git", ["status", "--short"], { cwd: repoPath }).toString(),
    ).toContain("src/app.ts");
  });

  it("allows a Web project path outside the process working directory", async () => {
    vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
      async () => ({
        toolRunId: "tool-run-web-path",
        findingCount: 0,
        exitCode: 0,
        elapsedMs: 10,
        artifactIds: [],
        diffUnmappedFindingCount: 0,
      }),
    );

    await expect(
      runProfileScan({
        db: connection.db,
        projectId,
        profileId: "baseline",
        repoPath,
        executionSurface: "web",
      }),
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("does not issue a final report before diagnostics complete", async () => {
    vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
      async () => {
        return {
          toolRunId: "tool-run-report",
          findingCount: 0,
          exitCode: 0,
          elapsedMs: 120,
          artifactIds: [],
          diffUnmappedFindingCount: 0,
        };
      },
    );

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "baseline",
      repoPath,
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(true);
    expect(await connection.db.select().from(scanReports)).toHaveLength(0);
  });

  it("persists and reports the explicit source SAST gap", async () => {
    const mockProfile = {
      id: "full-security-scan",
      name: "Truthful Full Scan",
      description: "Full scan without an optional Semgrep adapter",
      enabled: true,
      defaultTimeoutSec: 100,
      coverageGaps: ["source_sast_not_executed"],
      tools: [
        {
          toolId: "gitleaks",
          displayName: "Gitleaks",
          required: true,
          failurePolicy: "fail_profile" as const,
        },
      ],
      steps: [
        {
          kind: "static_tool" as const,
          toolId: "gitleaks",
          displayName: "Gitleaks",
          required: true,
          failurePolicy: "fail_profile" as const,
        },
      ],
    };
    const profilesModule = require("./profiles");
    const getProfileSpy = vi
      .spyOn(profilesModule, "getProfileById")
      .mockReturnValue(mockProfile);
    vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockResolvedValue({
      toolRunId: "tool-run-source-gap",
      findingCount: 0,
      exitCode: 0,
      elapsedMs: 10,
      artifactIds: [],
      diffUnmappedFindingCount: 0,
    });

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "full-security-scan",
      repoPath,
    });
    expect(result.profileOutcome).toBe("completed_with_warnings");

    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        resolvedProfile: expect.objectContaining({
          id: "full-security-scan",
          coverageGaps: ["source_sast_not_executed"],
        }),
        resolvedProfileHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        profileLimitationCodes: expect.arrayContaining([
          "source_sast_not_executed",
        ]),
        sourceSastCoverage: expect.objectContaining({
          state: "applicable",
          coverageEffect: "gap",
          limitationCodes: ["source_sast_not_executed"],
        }),
      }),
    );
    getProfileSpy.mockRestore();
  });

  it("should handle optional tool failure with completed_with_warnings status", async () => {
    const mockProfile = {
      id: "test-optional",
      name: "Test Optional Profile",
      description: "Profile for testing optional tool failure",
      enabled: true,
      defaultTimeoutSec: 100,
      tools: [
        {
          toolId: "gitleaks",
          displayName: "Gitleaks (Required)",
          required: true,
          failurePolicy: "fail_profile" as const,
        },
        {
          toolId: "trivy",
          displayName: "Trivy (Optional)",
          required: false,
          failurePolicy: "warn_and_continue" as const,
        },
      ],
    };

    const profilesModule = require("./profiles");
    const getProfileSpy = vi
      .spyOn(profilesModule, "getProfileById")
      .mockReturnValue(mockProfile);

    vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
      async (params) => {
        if (params.toolId === "trivy") {
          throw new Error("Optional tool failed mock error");
        }
        return {
          toolRunId: "tool-run-gitleaks",
          findingCount: 2,
          exitCode: 0,
          elapsedMs: 50,
          artifactIds: [],
          diffUnmappedFindingCount: 0,
        };
      },
    );

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "test-optional",
      repoPath,
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.profileOutcome).toBe("completed_with_warnings");
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0].status).toBe("completed");
    expect(result.toolResults[1].status).toBe("failed");
    expect(result.toolResults[1].error).toBe("Optional tool failed mock error");

    getProfileSpy.mockRestore();
  });

  it("should orchestrate static and DAST steps in one profile scan", async () => {
    const mockProfile = {
      id: "web-test",
      name: "Web Test Profile",
      description: "Profile for testing unified static and DAST steps",
      enabled: true,
      defaultTimeoutSec: 100,
      tools: [
        {
          toolId: "gitleaks",
          displayName: "Gitleaks",
          required: true,
          failurePolicy: "fail_profile" as const,
        },
      ],
      steps: [
        {
          kind: "static_tool" as const,
          toolId: "gitleaks",
          displayName: "Gitleaks",
          required: true,
          failurePolicy: "fail_profile" as const,
        },
        {
          kind: "dast" as const,
          profileId: "http-baseline" as const,
          displayName: "Auto DAST HTTP Baseline",
          required: false,
          failurePolicy: "warn_and_continue" as const,
          target: { mode: "auto_project_start" as const },
        },
      ],
    };

    const profilesModule = require("./profiles");
    const getProfileSpy = vi
      .spyOn(profilesModule, "getProfileById")
      .mockReturnValue(mockProfile);

    const staticSpy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockImplementation(async () => ({
        toolRunId: "tool-run-gitleaks",
        findingCount: 1,
        exitCode: 0,
        elapsedMs: 50,
        artifactIds: [],
        diffUnmappedFindingCount: 0,
      }));
    const dastSpy = vi
      .spyOn(profileRunnerModule, "runDastStepIntoExistingScan")
      .mockImplementation(async () => ({
        kind: "dast",
        profileId: "http-baseline",
        required: false,
        status: "completed",
        outcome: "passed",
        verdict: "no_findings_observed",
        coverageStatus: "covered",
        coverageSummary: {
          knownRouteCount: 1,
          actionableKnownRouteCount: 1,
          plannedRouteCount: 1,
          attemptedRouteCount: 1,
          successfulRouteCount: 1,
          failedRouteCount: 0,
          blockedRouteCount: 0,
          notTestedRouteCount: 0,
          requiredSeedCoverage: 1,
          actionableRouteCoverage: 1,
          requestCount: 1,
          responseBytesRead: 0,
          maxDepthReached: 0,
          transportErrorCount: 0,
          timeoutCount: 0,
          authFailureCount: 0,
          budgetExhausted: false,
          limitationCodes: [],
        },
        limitationCodes: [],
        findingCount: 0,
        dastRunId: "dast-run-1",
        targetOrigin: "http://127.0.0.1:3000",
        error: null,
      }));

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "web-test",
      repoPath,
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(true);
    expect(result.profileOutcome).toBe("completed");
    expect(result.toolResults).toHaveLength(1);
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0]).toEqual(
      expect.objectContaining({ kind: "static_tool", toolId: "gitleaks" }),
    );
    expect(result.stepResults[1]).toEqual(
      expect.objectContaining({
        kind: "dast",
        profileId: "http-baseline",
        dastRunId: "dast-run-1",
      }),
    );
    expect(staticSpy).toHaveBeenCalledTimes(1);
    expect(dastSpy).toHaveBeenCalledTimes(1);

    const [scanRun] = await connection.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, result.scanRunId));
    expect(scanRun.metadata).toEqual(
      expect.objectContaining({
        stepOrder: ["gitleaks", "dast:http-baseline"],
        stepResults: expect.arrayContaining([
          expect.objectContaining({ kind: "dast", dastRunId: "dast-run-1" }),
        ]),
      }),
    );

    getProfileSpy.mockRestore();
  });

  it("should fail profile when a fail_profile tool is marked optional", async () => {
    const mockProfile = {
      id: "test-fail-policy",
      name: "Test Failure Policy Profile",
      description: "Profile for testing fail_profile policy",
      enabled: true,
      defaultTimeoutSec: 100,
      tools: [
        {
          toolId: "gitleaks",
          displayName: "Gitleaks Optional But Blocking",
          required: false,
          failurePolicy: "fail_profile" as const,
        },
        {
          toolId: "trivy",
          displayName: "Trivy Optional Warning",
          required: false,
          failurePolicy: "warn_and_continue" as const,
        },
      ],
    };

    const profilesModule = require("./profiles");
    const getProfileSpy = vi
      .spyOn(profilesModule, "getProfileById")
      .mockReturnValue(mockProfile);

    vi.spyOn(profileRunnerModule, "runToolIntoExistingScan").mockImplementation(
      async (params) => {
        if (params.toolId === "gitleaks") {
          throw new Error("Policy-blocking optional tool failed");
        }
        return {
          toolRunId: "tool-run-trivy",
          findingCount: 1,
          exitCode: 0,
          elapsedMs: 50,
          artifactIds: [],
          diffUnmappedFindingCount: 0,
        };
      },
    );

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "test-fail-policy",
      repoPath,
      continueOnToolFailure: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.profileOutcome).toBe("failed");
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[0].required).toBe(false);
    expect(result.toolResults[0].status).toBe("failed");
    expect(result.toolResults[1].status).toBe("completed");

    getProfileSpy.mockRestore();
  });

  it("should stop execution on required tool failure when continueOnToolFailure is false", async () => {
    const runToolSpy = vi
      .spyOn(profileRunnerModule, "runToolIntoExistingScan")
      .mockImplementation(async (params) => {
        if (params.toolId === "gitleaks") {
          throw new Error("Required tool failed mock error");
        }
        return {
          toolRunId: "tool-run-ok",
          findingCount: 1,
          exitCode: 0,
          elapsedMs: 50,
          artifactIds: [],
          diffUnmappedFindingCount: 0,
        };
      });

    const result = await runProfileScan({
      db: connection.db,
      projectId,
      profileId: "baseline",
      repoPath,
      continueOnToolFailure: false,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("failed");
    expect(result.profileOutcome).toBe("failed");
    expect(result.toolResults[0].status).toBe("failed");
    expect(result.toolResults[1].status).toBe("skipped"); // osv skipped
  });

  it("should run runToolIntoExistingScan directly with mocked Bun.spawn for Gitleaks", async () => {
    const { ArtifactStorage } = require("./artifact-storage");
    const storage = new ArtifactStorage(tempDir);

    const spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation((args: any) => {
      const binary = args[0];
      if (binary === "gitleaks") {
        if (args.includes("version")) {
          return {
            exited: Promise.resolve(0),
            stdout: new Response("8.18.0\n"),
            stderr: new Response(""),
          } as any;
        }
        // Mock detect run
        const repIdx = args.indexOf("--report-path");
        if (repIdx !== -1 && args[repIdx + 1]) {
          const repPath = args[repIdx + 1];
          const mockResult = [
            {
              RuleID: "generic-api-key",
              Description: "Generic API Key Leak",
              File: "src/keys.txt",
              StartLine: 5,
              EndLine: 5,
              Secret: "x".repeat(32),
            },
          ];
          require("node:fs").writeFileSync(
            repPath,
            JSON.stringify(mockResult, null, 2),
            "utf8",
          );
        }
        return {
          exited: Promise.resolve(1),
          stdout: new Response(""),
          stderr: new Response(""),
        } as any;
      }
      return {
        exited: Promise.resolve(0),
        stdout: new Response(""),
        stderr: new Response(""),
      } as any;
    });

    const now = new Date();
    const [scanRun] = await connection.db
      .insert(scanRuns)
      .values({
        projectId,
        profile: "baseline",
        status: "running",
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const result = await profileRunnerModule.runToolIntoExistingScan({
      db: connection.db,
      projectId,
      scanRunId: scanRun.id,
      toolId: "gitleaks",
      artifactStorage: storage,
      repoPath,
      diffContext: {
        target: {
          schemaVersion: 1,
          kind: "working_tree",
          requested: {
            kind: "working_tree",
            base: "HEAD",
            includeUntracked: true,
          },
          projectPrefix: "",
          baseSha: "a".repeat(40),
          headSha: null,
          mergeBaseSha: null,
          includeUntracked: true,
          targetDigest: "b".repeat(64),
          snapshotDigest: "b".repeat(64),
          changedFileCount: 1,
          scannableFileCount: 1,
        },
        entries: [
          {
            status: "modified",
            path: "src/other.ts",
            contentSha256: "c".repeat(64),
            sizeBytes: 1,
            binary: false,
            inProfileScope: true,
            disposition: "scan",
            reasonCode: null,
          },
        ],
        inputKind: "changed_workspace",
      },
    });

    expect(result.toolRunId).toBeTruthy();
    expect(result.exitCode).toBe(1);
    expect(result.findingCount).toBe(1);
    expect(result.diffUnmappedFindingCount).toBe(1);
    expect(result.artifactIds.length).toBeGreaterThanOrEqual(1);
    const [persistedFinding] = await connection.db
      .select()
      .from(findings)
      .where(eq(findings.scanRunId, scanRun.id));
    expect(persistedFinding.metadata).toEqual(
      expect.objectContaining({
        diffRelation: expect.objectContaining({
          kind: "unmapped",
          reasonCode: "finding_path_not_in_diff_manifest",
        }),
      }),
    );
    const events = await connection.db
      .select()
      .from(scanEvents)
      .where(eq(scanEvents.scanRunId, scanRun.id));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          eventType: "finding.diff_unmapped",
        }),
      ]),
    );
    const [persistedToolRun] = await connection.db
      .select()
      .from(toolRuns)
      .where(eq(toolRuns.id, result.toolRunId));
    expect(persistedToolRun.metadata).toEqual(
      expect.objectContaining({ diffUnmappedFindingCount: 1 }),
    );

    spawnSpy.mockRestore();
  });
});
