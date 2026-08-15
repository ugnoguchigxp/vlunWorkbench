import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { dastRuns, dastTargetConfigs, findings, projects, scanRuns, toolRuns, users } from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import { buildScanRunSummary } from "./summary-builder";

describe("Summary Builder", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "summary-builder-test-"));
		dbFile = path.join(tempDir, "test.sqlite");
		dbUrl = `file:${dbFile}`;

		execSync("bun run db:migrate", {
			env: { ...process.env, DATABASE_URL: dbUrl },
		});

		connection = createDbConnection(dbUrl);

		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "summary-test@example.com",
				passwordHash: "hash",
				displayName: "Summary Test User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Summary Test Project",
				repoPath: tempDir,
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

	it("should calculate severity counts and totals correctly", async () => {
		const now = new Date();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				metadata: { profileOutcome: "completed_with_warnings" },
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		const [tr1] = await connection.db
			.insert(toolRuns)
			.values({
				scanRunId: scanRun.id,
				toolName: "semgrep",
				status: "completed",
				exitCode: 0,
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		const [tr2] = await connection.db
			.insert(toolRuns)
			.values({
				scanRunId: scanRun.id,
				toolName: "gitleaks",
				status: "failed",
				exitCode: 1,
				metadata: { error: "Failed to scan" },
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		// Add findings
		await connection.db.insert(findings).values([
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rules-1",
				title: "Vuln 1",
				description: "Desc 1",
				severity: "high",
				confidence: "static",
				status: "open",
				fingerprint: "fp1",
				createdAt: now,
				updatedAt: now,
			},
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rules-2",
				title: "Vuln 2",
				description: "Desc 2",
				severity: "medium",
				confidence: "static",
				status: "open",
				fingerprint: "fp2",
				createdAt: now,
				updatedAt: now,
			},
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "gitleaks",
				ruleId: "leak-1",
				title: "Leak 1",
				description: "Leak Desc 1",
				severity: "critical",
				confidence: "static",
				status: "open",
				fingerprint: "fp3",
				createdAt: now,
				updatedAt: now,
			},
		]);

		const summary = await buildScanRunSummary(connection.db, scanRun.id);

		expect(summary.scanRunId).toBe(scanRun.id);
		expect(summary.profileId).toBe("baseline");
		expect(summary.profileOutcome).toBe("completed_with_warnings");
		expect(summary.totals.findingCount).toBe(3);

		const semgrepSummary = summary.tools.find((t) => t.toolId === "semgrep");
		expect(semgrepSummary).toBeDefined();
		expect(semgrepSummary?.findingCount).toBe(2);
		expect(semgrepSummary?.severityCounts.high).toBe(1);
		expect(semgrepSummary?.severityCounts.medium).toBe(1);
		expect(semgrepSummary?.status).toBe("completed");

		const gitleaksSummary = summary.tools.find((t) => t.toolId === "gitleaks");
		expect(gitleaksSummary).toBeDefined();
		expect(gitleaksSummary?.findingCount).toBe(1);
		expect(gitleaksSummary?.severityCounts.critical).toBe(1);
		expect(gitleaksSummary?.status).toBe("failed");
		expect(gitleaksSummary?.error).toBe("Failed to scan");
	});

	it("should throw error if scanRun is missing", async () => {
		await expect(
			buildScanRunSummary(connection.db, "non-existent-id")
		).rejects.toThrow("Scan run not found: non-existent-id");
	});

	it("should include info and unknown severity counts", async () => {
		const now = new Date();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		await connection.db.insert(toolRuns).values({
			scanRunId: scanRun.id,
			toolName: "gitleaks",
			status: "completed",
			exitCode: 0,
			createdAt: now,
			updatedAt: now,
		});

		await connection.db.insert(findings).values([
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "gitleaks",
				ruleId: "rules-1",
				title: "Vuln 1",
				description: "Desc 1",
				severity: "info",
				confidence: "static",
				status: "open",
				fingerprint: "fp1",
				createdAt: now,
				updatedAt: now,
			},
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "gitleaks",
				ruleId: "rules-2",
				title: "Vuln 2",
				description: "Desc 2",
				severity: "unknown-severity-label",
				confidence: "static",
				status: "open",
				fingerprint: "fp2",
				createdAt: now,
				updatedAt: now,
			},
		]);

		const summary = await buildScanRunSummary(connection.db, scanRun.id);
		const gitleaksSummary = summary.tools.find((t) => t.toolId === "gitleaks");
		expect(gitleaksSummary?.severityCounts.info).toBe(1);
		expect(gitleaksSummary?.severityCounts.unknown).toBe(1);
	});

	it("should handle ad-hoc tool runs not defined in the profile", async () => {
		const now = new Date();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "custom-empty-profile",
				status: "completed",
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		await connection.db.insert(toolRuns).values({
			scanRunId: scanRun.id,
			toolName: "ad-hoc-scanner",
			status: "completed",
			exitCode: 0,
			createdAt: now,
			updatedAt: now,
		});

		await connection.db.insert(findings).values({
			scanRunId: scanRun.id,
			projectId,
			sourceTool: "ad-hoc-scanner",
			ruleId: "rules-adhoc",
			title: "Adhoc Vuln",
			description: "Adhoc Desc",
			severity: "low",
			confidence: "static",
			status: "open",
			fingerprint: "fp-adhoc",
			createdAt: now,
			updatedAt: now,
		});

		const summary = await buildScanRunSummary(connection.db, scanRun.id);
		const adhocSummary = summary.tools.find((t) => t.toolId === "ad-hoc-scanner");
		expect(adhocSummary).toBeDefined();
		expect(adhocSummary?.findingCount).toBe(1);
		expect(adhocSummary?.required).toBe(false);
	});

	it("should map DAST steps and dastRuns successfully", async () => {
		const now = new Date();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "web-app-baseline",
				status: "completed",
				metadata: {
					stepResults: [
						{
							kind: "dast",
							profileId: "web-passive-standard",
							status: "completed",
							findingCount: 2,
							error: "Dast warning",
							outcome: "completed_with_warnings",
							targetOrigin: "http://127.0.0.1:4000",
						},
					],
				},
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		const [targetConfig] = await connection.db
			.insert(dastTargetConfigs)
			.values({
				projectId,
				name: "Test Target",
				origin: "http://127.0.0.1:4000",
				normalizedOrigin: "http://127.0.0.1:4000",
				createdAt: now,
				updatedAt: now,
			})
			.returning();

		await connection.db.insert(dastRuns).values({
			scanRunId: scanRun.id,
			projectId,
			targetConfigId: targetConfig.id,
			profileId: "web-passive-standard",
			dastKind: "http",
			targetOrigin: "http://127.0.0.1:4000",
			runnerOrigin: "http://127.0.0.1:4000",
			status: "completed",
			errorMessage: "Dast warning",
			outcome: "completed_with_warnings",
			createdAt: now,
			updatedAt: now,
		});

		const summary = await buildScanRunSummary(connection.db, scanRun.id);
		expect(summary.steps).toBeDefined();
		const dastStep = summary.steps?.find(
			(s) => s.id === "dast:web-passive-standard",
		);
		expect(dastStep).toBeDefined();
		expect(dastStep?.status).toBe("completed");
		expect(dastStep?.error).toBe("Dast warning");
		expect(dastStep?.outcome).toBe("completed_with_warnings");
		expect(dastStep?.targetOrigin).toBe("http://127.0.0.1:4000");
	});
});
