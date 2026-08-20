import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
  projects,
  scanDiagnosticRuns,
  scanReports,
  scanRuns,
  users,
} from "../../db/schema";
import { ArtifactStorage } from "./artifact-storage";
import { finalizeScanAfterDiagnostic } from "./scan-finalization-service";

function applyMigrations(connection: DbConnection) {
  const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
  for (const filename of readdirSync(migrationsDirectory)
    .filter((entry) => entry.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))) {
    connection.sqlite.exec(
      readFileSync(path.join(migrationsDirectory, filename), "utf8"),
    );
  }
}

describe("scan finalization service", () => {
  let connection: DbConnection;
  let artifactRoot: string;
  let scanRunId: string;

  beforeEach(async () => {
    connection = createDbConnection(":memory:");
    applyMigrations(connection);
    artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scan-finalization-"));
    const now = new Date("2026-08-21T00:00:00.000Z");
    const [owner] = await connection.db
      .insert(users)
      .values({
        email: "finalization@example.invalid",
        passwordHash: "hash",
        displayName: "Finalization fixture",
        role: "member",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [project] = await connection.db
      .insert(projects)
      .values({
        ownerUserId: owner.id,
        name: "Finalization fixture",
        repoPath: "/workspace/finalization-fixture",
        canonicalRepoPath: "/workspace/finalization-fixture",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [scan] = await connection.db
      .insert(scanRuns)
      .values({
        projectId: project.id,
        profile: "baseline",
        status: "completed",
        profileOutcome: "completed",
        createdByUserId: owner.id,
        startedAt: now,
        completedAt: now,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    scanRunId = scan.id;
  });

  afterEach(async () => {
    connection.sqlite.close();
    await fs.rm(artifactRoot, { recursive: true, force: true });
  });

  const options = {
    enabled: true,
    title: "Canonical security report",
    includeFalsePositives: false,
    includeDeferred: false,
    includeUndecided: true,
  };

  it("refuses finalization until a terminal diagnostic exists", async () => {
    const result = await finalizeScanAfterDiagnostic({
      db: connection.db,
      scanRunId,
      options,
      artifactStorage: new ArtifactStorage(artifactRoot),
    });

    expect(result).toMatchObject({
      ok: false,
      status: "skipped",
      error: "automated_diagnostic_required_before_final_report",
    });
    expect(await connection.db.select().from(scanReports)).toHaveLength(0);
  });

  it("creates and reuses exactly one canonical final after diagnostic completion", async () => {
    const now = new Date("2026-08-21T00:02:00.000Z");
    await connection.db.insert(scanDiagnosticRuns).values({
      scanRunId,
      inputSnapshotHash: `sha256:${"a".repeat(64)}`,
      scannerProvenanceHash: `sha256:${"b".repeat(64)}`,
      pipelineVersion: "automated-scan-diagnostic-v1",
      status: "completed",
      limitationCodes: [],
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const first = await finalizeScanAfterDiagnostic({
      db: connection.db,
      scanRunId,
      options,
      artifactStorage: new ArtifactStorage(artifactRoot),
    });
    const second = await finalizeScanAfterDiagnostic({
      db: connection.db,
      scanRunId,
      options,
      artifactStorage: new ArtifactStorage(artifactRoot),
    });
    const reports = await connection.db
      .select()
      .from(scanReports)
      .where(eq(scanReports.scanRunId, scanRunId));

    expect(first).toMatchObject({ ok: true, status: "completed" });
    expect(second).toMatchObject({
      ok: true,
      status: "completed",
      reportId: first.reportId,
      artifactId: first.artifactId,
    });
    expect(reports).toEqual([
      expect.objectContaining({
        id: first.reportId,
        stage: "canonical_final",
        status: "completed",
        artifactId: first.artifactId,
        options: expect.objectContaining({
          diagnosticSnapshotHash: `sha256:${"a".repeat(64)}`,
          diagnosticPipelineVersion: "automated-scan-diagnostic-v1",
        }),
      }),
    ]);
  });
});
