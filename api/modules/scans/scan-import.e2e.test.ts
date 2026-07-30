import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";

describe("Scan Import E2E", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let artifactRoot: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-scan-"));
		dbFile = path.join(tempDir, "e2e-test.sqlite");
		dbUrl = `file:${dbFile}`;
		artifactRoot = path.join(tempDir, "artifacts", "scans");

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
				email: "e2e-test@example.com",
				passwordHash: "hash",
				displayName: "E2E Test User",
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
				name: "E2E Test Project",
				repoPath: process.cwd(),
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
	});

	it("should import fixture scan results successfully via CLI", async () => {
		const fixturePath = path.resolve(
			process.cwd(),
			"tests/fixtures/scans/fixture-finding.json",
		);

		const cmd = `bun run api/cli/scan-import.ts --project-id ${projectId} --tool fixture --artifact ${fixturePath}`;
		const output = execSync(cmd, {
			env: {
				...process.env,
				DATABASE_URL: dbUrl,
				SCAN_ARTIFACT_ROOT: artifactRoot,
			},
			encoding: "utf8",
		});

		const result = JSON.parse(output.trim());
		expect(result.ok).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.findingCount).toBe(2);
		expect(result.evidenceCount).toBe(4);
		expect(result.toolRunId).toBeTruthy();

		// Verify database rows directly
		const scanRunRow = await connection.db.query.scanRuns.findFirst({
			where: (fields, { eq }) => eq(fields.id, result.scanRunId),
		});
		expect(scanRunRow).toBeDefined();
		expect(scanRunRow?.status).toBe("completed");

		// Verify findings are present and secrets are redacted
		const findingsList = await connection.db.query.findings.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(findingsList.length).toBe(2);

		const artifacts = await connection.db.query.scanArtifacts.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(artifacts.length).toBeGreaterThanOrEqual(2);
		const rawArtifact = artifacts.find(
			(artifact) => artifact.kind === "raw_result",
		);
		expect(rawArtifact?.toolRunId).toBe(result.toolRunId);
		expect(rawArtifact?.path).toContain(
			path.join("raw", "fixture-finding.json"),
		);
		await fs.access(path.resolve(artifactRoot, rawArtifact?.path ?? ""));
		expect(result.diagnostic).toMatchObject({
			status: "completed_with_limitations",
			readiness: "ready_with_limitations",
		});

		const hardcodedKeyFinding = findingsList.find(
			(f) => f.ruleId === "fixture.rule.1",
		);
		expect(hardcodedKeyFinding).toBeDefined();

		// Verify evidence is present and snippet is redacted
		const evidenceList = await connection.db.query.findingEvidences.findMany({
			where: (fields, { eq }) => eq(fields.findingId, hardcodedKeyFinding!.id),
		});
		expect(evidenceList.length).toBe(2);

		// Evidence 1: source-location
		const sourceLocEv = evidenceList.find((e) => e.kind === "source-location");
		expect(sourceLocEv?.snippet).toContain("[REDACTED]");
		expect(sourceLocEv?.snippet).not.toContain("fixtureSensitiveValue123");

		// Evidence 2: tool-output
		const toolOutputEv = evidenceList.find((e) => e.kind === "tool-output");
		expect(toolOutputEv?.snippet).toContain("[REDACTED]");
		expect(toolOutputEv?.snippet).not.toContain("fixtureSensitiveValue123");
	});
});
