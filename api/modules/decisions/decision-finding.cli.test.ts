import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users, projects, scanRuns, findings, findingReviews, findingDecisions } from "../../db/schema";
import { ProjectRepository, ScanRepository, FindingRepository } from "../scans/repositories";
import { FindingReviewRepository } from "../reviews/finding-review-repository";

describe("CLI decision:finding", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId: string;
	let reviewId: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "decision-cli-test-"));
		dbFile = path.join(tempDir, "test.sqlite");
		dbUrl = `file:${dbFile}`;

		// Run migrations on the test database
		execSync("bun run db:migrate", {
			env: { ...process.env, DATABASE_URL: dbUrl },
		});

		connection = createDbConnection(dbUrl);

		const now = new Date();
		// Seed user
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "cli-test@example.com",
				passwordHash: "hash",
				displayName: "CLI Test User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed project
		const projectRepo = new ProjectRepository(connection.db);
		const project = await projectRepo.createProject({
			name: "CLI Project",
			repoPath: "/path/to/cli-project",
			ownerUserId: userId,
		});
		projectId = project.id;

		// Seed scan run
		const scanRepo = new ScanRepository(connection.db);
		const scanRun = await scanRepo.createScanRun({
			projectId,
			profile: "baseline",
			status: "completed",
			createdByUserId: userId,
		});
		scanRunId = scanRun.id;

		// Seed finding
		const findingRepo = new FindingRepository(connection.db);
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rule-123",
				title: "XSS Vulnerability",
				description: "Reflected XSS",
				severity: "high",
				confidence: "static",
				status: "open",
				fingerprint: "fingerprint-123",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId = finding.id;

		// Seed a finding review
		const reviewRepo = new FindingReviewRepository(connection.db);
		const review = await reviewRepo.createReview({
			findingId,
			provider: "azure-openai",
			model: "gpt-4",
			status: "completed",
			createdByUserId: userId,
		});
		reviewId = review.id;
	});

	afterEach(async () => {
		if (connection) {
			connection.sqlite.close(false);
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it("should record a decision successfully via CLI", () => {
		const cmd = `bun run api/cli/decision-finding.ts --finding-id ${findingId} --decision accepted --reason confirmed_by_review --comment "Validating CLI" --linked-review-id ${reviewId} --decided-by-user-id ${userId}`;

		const output = execSync(cmd, {
			env: { ...process.env, DATABASE_URL: dbUrl },
		}).toString();

		const result = JSON.parse(output.trim());
		expect(result.ok).toBe(true);
		expect(result.status).toBe("completed");
		expect(result.decision.decision).toBe("accepted");
		expect(result.decision.reason).toBe("confirmed_by_review");
		expect(result.decision.comment).toBe("Validating CLI");
		expect(result.decision.linkedReviewId).toBe(reviewId);
		expect(result.decision.decidedByUserId).toBe(userId);
	});

	it("should fail validation if finding-id is missing", () => {
		const cmd = `bun run api/cli/decision-finding.ts --decision accepted --reason confirmed_by_review`;

		try {
			execSync(cmd, {
				env: { ...process.env, DATABASE_URL: dbUrl },
				stdio: "pipe",
			});
			throw new Error("Expected to fail");
		} catch (err: any) {
			const result = JSON.parse(err.stdout.toString().trim());
			expect(result.ok).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.message).toContain("--finding-id is required");
		}
	});

	it("should fail validation if finding does not exist", () => {
		const fakeFindingId = "00000000-0000-0000-0000-000000000000";
		const cmd = `bun run api/cli/decision-finding.ts --finding-id ${fakeFindingId} --decision accepted --reason confirmed_by_review`;

		try {
			execSync(cmd, {
				env: { ...process.env, DATABASE_URL: dbUrl },
				stdio: "pipe",
			});
			throw new Error("Expected to fail");
		} catch (err: any) {
			const result = JSON.parse(err.stdout.toString().trim());
			expect(result.ok).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.message).toContain("Finding not found");
		}
	});
});
