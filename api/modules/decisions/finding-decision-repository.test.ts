import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users, projects, scanRuns, findings, findingReviews } from "../../db/schema";
import { ProjectRepository, ScanRepository, FindingRepository } from "../scans/repositories";
import { FindingReviewRepository } from "../reviews/finding-review-repository";
import { FindingDecisionRepository } from "./finding-decision-repository";

describe("FindingDecisionRepository", () => {
	let connection: DbConnection;
	let projectRepo: ProjectRepository;
	let scanRepo: ScanRepository;
	let findingRepo: FindingRepository;
	let reviewRepo: FindingReviewRepository;
	let decisionRepo: FindingDecisionRepository;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");

		// Apply Drizzle migrations manually to in-memory SQLite
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sqlText = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sqlText);
		}

		projectRepo = new ProjectRepository(connection.db);
		scanRepo = new ScanRepository(connection.db);
		findingRepo = new FindingRepository(connection.db);
		reviewRepo = new FindingReviewRepository(connection.db);
		decisionRepo = new FindingDecisionRepository(connection.db);

		// Seed user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "decision-test@example.com",
				passwordHash: "hash",
				displayName: "Test User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed project
		const project = await projectRepo.createProject({
			ownerUserId: userId,
			name: "Test Project",
			repoPath: "/path/to/repo",
		});
		projectId = project.id;

		// Seed scan run
		const scan = await scanRepo.createScanRun({
			projectId,
			profile: "baseline",
			status: "completed",
		});
		scanRunId = scan.id;

		// Seed finding
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rules.test",
				title: "Test Vulnerability",
				description: "Test description",
				severity: "high",
				confidence: "static",
				status: "open",
				fingerprint: "fingerprint123",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId = finding.id;
	});

	afterEach(() => {
		connection.sqlite.close(false);
	});

	it("should create a decision successfully and find it by id", async () => {
		const decision = await decisionRepo.createDecision({
			findingId,
			decision: "needs_fix",
			reason: "confirmed_by_evidence",
			comment: "Looks dangerous",
			decidedByUserId: userId,
		});

		expect(decision.id).toBeDefined();
		expect(decision.decision).toBe("needs_fix");
		expect(decision.reason).toBe("confirmed_by_evidence");
		expect(decision.comment).toBe("Looks dangerous");
		expect(decision.decidedByUserId).toBe(userId);

		const found = await decisionRepo.findById(decision.id);
		expect(found).not.toBeNull();
		expect(found?.decision).toBe("needs_fix");
	});

	it("should return null for non-existent decision id", async () => {
		const found = await decisionRepo.findById("00000000-0000-0000-0000-000000000000");
		expect(found).toBeNull();
	});

	it("should retrieve history list and latest decision correctly", async () => {
		// No decisions initially
		const latest1 = await decisionRepo.findLatestDecisionForFinding(findingId);
		expect(latest1).toBeNull();

		// Add first decision (deferred)
		await decisionRepo.createDecision({
			findingId,
			decision: "deferred",
			reason: "insufficient_evidence",
			decidedByUserId: userId,
		});

		await new Promise((resolve) => setTimeout(resolve, 5));

		// Add second decision (accepted)
		const dec2 = await decisionRepo.createDecision({
			findingId,
			decision: "accepted",
			reason: "confirmed_by_review",
			decidedByUserId: userId,
		});

		const latest2 = await decisionRepo.findLatestDecisionForFinding(findingId);
		expect(latest2).not.toBeNull();
		expect(latest2?.decision).toBe("accepted");
		expect(latest2?.id).toBe(dec2.id);

		const history = await decisionRepo.listDecisionsForFinding(findingId);
		expect(history).toHaveLength(2);
		expect(history[0].decision).toBe("accepted"); // desc
		expect(history[1].decision).toBe("deferred");
	});

	it("should fail when linkedReviewId does not exist", async () => {
		await expect(
			decisionRepo.createDecision({
				findingId,
				decision: "accepted",
				reason: "confirmed_by_review",
				linkedReviewId: "00000000-0000-0000-0000-000000000000",
			}),
		).rejects.toThrow("Linked review not found");
	});

	it("should fail when linkedReviewId belongs to another finding", async () => {
		// Seed another finding
		const [otherFinding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rules.other",
				title: "Other Vulnerability",
				description: "Other description",
				severity: "low",
				confidence: "static",
				status: "open",
				fingerprint: "fingerprint456",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();

		// Seed a review on the other finding
		const review = await reviewRepo.createReview({
			findingId: otherFinding.id,
			provider: "azure-openai",
			model: "gpt-4",
			status: "completed",
		});

		// Try to create decision linking other finding's review
		await expect(
			decisionRepo.createDecision({
				findingId,
				decision: "accepted",
				reason: "confirmed_by_review",
				linkedReviewId: review.id,
			}),
		).rejects.toThrow("Linked review does not belong to this finding");
	});

	it("should succeed when linkedReviewId belongs to the same finding", async () => {
		const review = await reviewRepo.createReview({
			findingId,
			provider: "azure-openai",
			model: "gpt-4",
			status: "completed",
		});

		const decision = await decisionRepo.createDecision({
			findingId,
			decision: "accepted",
			reason: "confirmed_by_review",
			linkedReviewId: review.id,
		});

		expect(decision.linkedReviewId).toBe(review.id);
	});
});
