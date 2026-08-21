import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findingGroupingRuns,
	findingIssueGroupMembers,
	findingIssueGroups,
	findingEvidences,
	findings,
	projects,
	scanRuns,
	users,
} from "../../db/schema";
import { closeTestDbConnection } from "../../db/testing/connection";
import { buildGroupedFindings } from "./grouping-builder";
import { FindingGroupingRunner } from "./finding-grouping-runner";

describe("Grouping Builder", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grouping-builder-test-"));
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
				email: "grouping-test@example.com",
				passwordHash: "hash",
				displayName: "Grouping Test User",
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
				name: "Grouping Test Project",
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

	it("should group dependency vulnerabilities, secrets, and source code findings correctly", async () => {
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

		// Add dependency findings (OSV and Trivy)
		await connection.db.insert(findings).values([
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "osv",
				ruleId: "GHSA-1",
				title: "Vuln 1",
				description: "Desc 1",
				severity: "high",
				confidence: "static",
				status: "open",
				fingerprint: "fp1",
				metadata: {
					packageName: "lodash",
					packageVersion: "4.17.20",
					ecosystem: "npm",
					advisoryId: "GHSA-1",
				},
				createdAt: now,
				updatedAt: now,
			},
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "trivy",
				ruleId: "GHSA-1",
				title: "Vuln 1 (Trivy)",
				description: "Desc 1",
				severity: "critical",
				confidence: "static",
				status: "open",
				fingerprint: "fp2",
				metadata: {
					packageName: "lodash",
					installedVersion: "4.17.20",
					vulnerabilityId: "GHSA-1",
					type: "npm",
				},
				createdAt: now,
				updatedAt: now,
			},
			// Secret finding
			{
				scanRunId: scanRun.id,
				projectId,
				sourceTool: "gitleaks",
				ruleId: "gitleaks-secret-1",
				title: "Secret leak",
				description: "Private key detected",
				severity: "high",
				confidence: "static",
				status: "open",
				fingerprint: "fp3",
				primaryLocation: { path: "src/index.js", startLine: 10 },
				createdAt: now,
				updatedAt: now,
			},
		]);

		const result = await buildGroupedFindings(connection.db, scanRun.id);

		// We should have 2 groups: 1 for lodash dependency vulnerability, 1 for gitleaks secret
		expect(result.groups).toHaveLength(2);

		const depGroup = result.groups.find((g) => g.metadata.strategy === "dependency");
		expect(depGroup).toBeDefined();
		expect(depGroup?.findingIds).toHaveLength(2);
		expect(depGroup?.severity).toBe("critical"); // Max severity between high and critical
		expect(depGroup?.sourceTools).toContain("osv");
		expect(depGroup?.sourceTools).toContain("trivy");
		await connection.db.insert(findingEvidences).values({
			findingId: depGroup?.findingIds[0] as string,
			kind: "source-location",
			title: "dependency manifest",
			location: { path: "package-lock.json" },
			createdAt: now,
		});
		const detail = await new FindingGroupingRunner(
			connection.db,
		).getCurrentGroupDetail(scanRun.id, depGroup?.id as string);
		expect(detail?.members).toHaveLength(2);
		expect(detail?.members.flatMap((member) => member.evidence)).toHaveLength(1);

		const secretGroup = result.groups.find((g) => g.metadata.strategy === "secret");
		expect(secretGroup).toBeDefined();
		expect(secretGroup?.findingIds).toHaveLength(1);
		expect(secretGroup?.severity).toBe("high");
		expect(result.grouping).toMatchObject({
			runStatus: "completed",
			rawFindingCount: 3,
			issueCount: 2,
			suppressedCount: 1,
		});

		const [storedRuns, storedGroups, storedMembers] = await Promise.all([
			connection.db.select().from(findingGroupingRuns),
			connection.db.select().from(findingIssueGroups),
			connection.db.select().from(findingIssueGroupMembers),
		]);
		expect(storedRuns).toHaveLength(1);
		expect(storedGroups).toHaveLength(2);
		expect(storedMembers).toHaveLength(3);

		const replay = await buildGroupedFindings(connection.db, scanRun.id);
		expect(replay.grouping?.runId).toBe(result.grouping?.runId);
		expect(await connection.db.select().from(findingGroupingRuns)).toHaveLength(
			1,
		);
	});
});
