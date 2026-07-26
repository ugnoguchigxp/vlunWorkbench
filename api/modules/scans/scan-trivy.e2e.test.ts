import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";

describe("Trivy CLI Scan E2E", () => {
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
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vuln-workbench-trivy-e2e-"));
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
				email: "trivy-e2e-test@example.com",
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

	it("should fail gracefully when trivy executable is missing", async () => {
		const cmd = `${process.execPath} run api/cli/scan-trivy.ts --project-id ${projectId}`;

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
			expect(result.message).toBe("Trivy executable not found");
			expect(err.status).toBe(1);
		}

		expect(errorThrown).toBe(true);

		// Verify no completed scan runs exist in DB
		const scanRuns = await connection.db.query.scanRuns.findMany();
		expect(scanRuns).toHaveLength(0);
	});

	it("should run successfully and create database entries when mock trivy executable is present", async () => {
		const mockTrivyPath = path.join(mockBinDir, "trivy");
		const mockTrivyContent = `#!${process.execPath}
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);

if (args.includes("--version")) {
	console.log("0.48.0");
	process.exit(0);
}

const outIdx = args.indexOf("--output");
if (outIdx !== -1 && args[outIdx + 1]) {
	const outPath = args[outIdx + 1];
	const mockResult = {
		Results: [
			{
				Target: "package.json",
				Class: "lang-pkgs",
				Type: "npm",
				Vulnerabilities: [
					{
						VulnerabilityID: "CVE-2023-12345",
						PkgName: "axios",
						InstalledVersion: "0.21.1",
						FixedVersion: "0.21.2",
						Severity: "CRITICAL",
						Title: "DoS in axios",
						Description: "Axios description"
					}
				]
			}
		]
	};
	await fs.mkdir(path.dirname(outPath), { recursive: true });
	await fs.writeFile(outPath, JSON.stringify(mockResult, null, 2));
}

process.exit(0); // Exiting with 0 because Trivy fs scan exits with 0 on completed scan
`;

		await fs.writeFile(mockTrivyPath, mockTrivyContent, { mode: 0o755 });

		const cmd = `${process.execPath} run api/cli/scan-trivy.ts --project-id ${projectId} --profile my-trivy-profile`;
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

		// Verify database rows directly
		const scanRunRow = await connection.db.query.scanRuns.findFirst({
			where: (fields, { eq }) => eq(fields.id, result.scanRunId),
		});
		expect(scanRunRow).toBeDefined();
		expect(scanRunRow?.status).toBe("completed");
		expect(scanRunRow?.profile).toBe("my-trivy-profile");

		const toolRunRow = await connection.db.query.toolRuns.findFirst({
			where: (fields, { eq }) => eq(fields.id, result.toolRunId),
		});
		expect(toolRunRow?.metadata).toMatchObject({
			adapter: "trivy",
			findingCount: 1,
			evidenceCount: 2,
		});

		// Verify findings are present
		const findingsList = await connection.db.query.findings.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(findingsList.length).toBe(1);
		expect(findingsList[0].ruleId).toBe("CVE-2023-12345");
		expect(findingsList[0].severity).toBe("critical");

		// Verify metadata in DB finding
		const metadata = findingsList[0].metadata as any;
		expect(metadata.packageName).toBe("axios");
		expect(metadata.installedVersion).toBe("0.21.1");
		expect(metadata.fixedVersion).toBe("0.21.2");

		// Verify artifact records in DB
		const dbArtifacts = await connection.db.query.scanArtifacts.findMany({
			where: (fields, { eq }) => eq(fields.scanRunId, result.scanRunId),
		});
		expect(dbArtifacts.length).toBeGreaterThanOrEqual(1);
		
		const rawJsonArtifact = dbArtifacts.find((a) => a.kind === "raw_result");
		expect(rawJsonArtifact).toBeDefined();
		expect(rawJsonArtifact?.path).toContain("trivy-result.json");
		
		// Verify evidence is present
		const evidenceList = await connection.db.query.findingEvidences.findMany({
			where: (fields, { eq }) => eq(fields.findingId, findingsList[0].id),
		});
		expect(evidenceList.length).toBe(2);

		// Evidence 1: source-location
		const sourceLocEv = evidenceList.find((e) => e.kind === "source-location");
		expect(sourceLocEv?.title).toBe("Dependency: axios@0.21.1 in package.json");

		// Evidence 2: tool-output
		const toolOutputEv = evidenceList.find((e) => e.kind === "tool-output");
		expect(toolOutputEv?.snippet).toContain("CVE-2023-12345");
	});
});
