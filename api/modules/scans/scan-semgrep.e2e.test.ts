import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";

describe("Semgrep CLI Scan E2E", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let artifactRoot: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let mockBinDir: string;
	let repoPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-semgrep-e2e-"));
		dbFile = path.join(tempDir, "e2e-test.sqlite");
		dbUrl = `file:${dbFile}`;
		artifactRoot = path.join(tempDir, "artifacts", "scans");
		mockBinDir = path.join(tempDir, "bin");
		repoPath = path.join(tempDir, "repo");

		await fs.mkdir(mockBinDir, { recursive: true });
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
				email: "semgrep-e2e-test@example.com",
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
	});

	it("should fail gracefully when semgrep executable is missing", async () => {
		const cmd = `${process.execPath} run api/cli/scan-semgrep.ts --project-id ${projectId}`;

		let errorThrown = false;
		try {
			execSync(cmd, {
				env: {
					...process.env,
					DATABASE_URL: dbUrl,
					SCAN_ARTIFACT_ROOT: artifactRoot,
					PATH: mockBinDir,
				},
				encoding: "utf8",
			});
		} catch (err: any) {
			errorThrown = true;
			const result = JSON.parse(err.stdout.trim());
			expect(result.ok).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.message).toBe("Semgrep executable not found");
			expect(err.status).toBe(1);
		}

		expect(errorThrown).toBe(true);

		// Verify no completed scan runs exist in DB
		const scanRuns = await connection.db.query.scanRuns.findMany();
		expect(scanRuns).toHaveLength(0);
	});

	it("should run successfully and create database entries when mock semgrep executable is present", async () => {
		// Create a mock semgrep executable in our bin directory
		const mockSemgrepPath = path.join(mockBinDir, "semgrep");
		const mockSemgrepContent = `#!${process.execPath}
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
	console.log("1.2.3");
	process.exit(0);
}

const outIdx = args.indexOf("--output");
if (outIdx !== -1 && args[outIdx + 1]) {
	const outPath = args[outIdx + 1];
	const mockToken = "ghp_" + "123456789012345678901234567890123678";
	const mockResult = {
		results: [
			{
				check_id: "rules.security.mock-detect",
				path: "src/auth.ts",
				start: { line: 10, col: 5 },
				end: { line: 10, col: 20 },
				extra: {
					message: "Mock finding detected",
					lines: \`const token = "\${mockToken}"\`,
					severity: "ERROR",
					metadata: { cwe: "CWE-798" }
				}
			}
		]
	};
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(mockResult, null, 2));
}

process.exit(0);
`;

		await fs.writeFile(mockSemgrepPath, mockSemgrepContent, { mode: 0o755 });

		const cmd = `${process.execPath} run api/cli/scan-semgrep.ts --project-id ${projectId} --profile my-semgrep-profile --config auto`;
		const output = execSync(cmd, {
			env: {
				...process.env,
				DATABASE_URL: dbUrl,
				SCAN_ARTIFACT_ROOT: artifactRoot,
				PATH: mockBinDir,
			},
			encoding: "utf8",
		});

		const result = JSON.parse(output.trim());
		expect(result.ok).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.findingCount).toBe(1);
		expect(result.evidenceCount).toBe(2);
		expect(result.toolRunId).toBeTruthy();
		expect(result.diagnostic).toMatchObject({
			status: "completed_with_limitations",
			readiness: "ready_with_limitations",
		});

		// Verify database rows directly
		const scanRunRow = await connection.db.query.scanRuns.findFirst({
			where: (fields, { eq }) => eq(fields.id, result.scanRunId),
		});
		expect(scanRunRow).toBeDefined();
		expect(scanRunRow?.status).toBe("completed");
		expect(scanRunRow?.profile).toBe("my-semgrep-profile");

		const toolRunRow = await connection.db.query.toolRuns.findFirst({
			where: (fields, { eq }) => eq(fields.id, result.toolRunId),
		});
		expect(toolRunRow?.metadata).toMatchObject({
			adapter: "semgrep",
			findingCount: 1,
			evidenceCount: 2,
			config: "auto",
		});

		// Verify findings are present and secrets are redacted
		const findingsList = await connection.db.query.findings.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(findingsList.length).toBe(1);
		expect(findingsList[0].ruleId).toBe("rules.security.mock-detect");
		expect(findingsList[0].severity).toBe("high");

		// Verify artifact records in DB
		const dbArtifacts = await connection.db.query.scanArtifacts.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(dbArtifacts.length).toBeGreaterThanOrEqual(1);
		
		const rawJsonArtifact = dbArtifacts.find((a) => a.kind === "raw_result");
		expect(rawJsonArtifact).toBeDefined();
		expect(rawJsonArtifact?.path).toContain("semgrep-result.json");
		const rawArtifactContent = await fs.readFile(
			path.join(artifactRoot, rawJsonArtifact?.path ?? ""),
			"utf8",
		);
		expect(rawArtifactContent).toContain("[REDACTED]");
		expect(rawArtifactContent).not.toContain("ghp_1234567890123");
		
		// Verify evidence is present and snippet is redacted
		const evidenceList = await connection.db.query.findingEvidences.findMany({
			where: (fields, { eq }) => eq(fields.findingId, findingsList[0].id),
		});
		expect(evidenceList.length).toBe(2);

		// Evidence 1: source-location
		const sourceLocEv = evidenceList.find((e) => e.kind === "source-location");
		expect(sourceLocEv?.snippet).toContain("[REDACTED]");
		expect(sourceLocEv?.snippet).not.toContain("ghp_1234567890123");

		// Evidence 2: tool-output
		const toolOutputEv = evidenceList.find((e) => e.kind === "tool-output");
		expect(toolOutputEv?.snippet).toContain("[REDACTED]");
		expect(toolOutputEv?.snippet).not.toContain("ghp_1234567890123");
	});
});
