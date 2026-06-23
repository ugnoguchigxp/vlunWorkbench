import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import { users, projects, scanRuns, findings, findingEvidences } from "../../db/schema";
import { extractSourceSnippet, buildReviewBundle } from "./finding-review-bundle";
import { FindingReviewRunner } from "./finding-review-runner";
import type { LlmProvider } from "../../providers/types";

describe("FindingReviewRunner", () => {
	let tempDir: string;
	let dbFile: string;
	let dbUrl: string;
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId: string;
	let repoPath: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "review-runner-test-"));
		dbFile = path.join(tempDir, "test.sqlite");
		dbUrl = `file:${dbFile}`;
		repoPath = path.join(tempDir, "repo");
		await fs.mkdir(repoPath, { recursive: true });

		// Migrate test database
		execSync("bun run db:migrate", {
			env: { ...process.env, DATABASE_URL: dbUrl },
		});

		connection = createDbConnection(dbUrl);

		// Seed a user
		const now = new Date();
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "review-test@example.com",
				passwordHash: "hash",
				displayName: "Test User",
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
				name: "Test Project",
				repoPath,
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;

		// Seed a scan run
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun.id;

		// Seed a finding
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "semgrep",
				ruleId: "rules.detect-slack-token",
				title: "Hardcoded Slack Token",
				description: "Slack API Token in code",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: {
					path: "src/auth.ts",
					startLine: 2,
					endLine: 2,
				},
				fingerprint: "hash",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId = finding.id;

		// Seed evidence
		await connection.db
			.insert(findingEvidences)
			.values({
				findingId,
				kind: "source-location",
				title: "Location in src/auth.ts",
				location: {
					path: "src/auth.ts",
					startLine: 2,
					endLine: 2,
				},
				snippet: `const slack = "${["xoxb", "12345678901", "abcdef"].join("-")}";`,
				createdAt: now,
			});
	});

	afterEach(async () => {
		if (connection) {
			connection.sqlite.close();
		}
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	describe("extractSourceSnippet", () => {
		it("should extract snippet successfully and redact secrets", async () => {
			const filePath = path.join(repoPath, "src/auth.ts");
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			const slackToken = [
				"xoxb",
				"12345678901",
				"12345678901",
				"abcdefghijklmnopqrstuvwx",
			].join("-");
			await fs.writeFile(
				filePath,
				`// First line\nconst slack = "${slackToken}";\n// Third line`,
			);

			const snippet = await extractSourceSnippet(repoPath, "src/auth.ts", 2, 2);
			expect(snippet).toContain("[REDACTED]");
			expect(snippet).not.toContain("xoxb-123");
		});

		it("should prevent path traversal", async () => {
			const snippet = await extractSourceSnippet(repoPath, "../outside.ts", 1, 5);
			expect(snippet).toContain("snippetUnavailable: Path traversal detected.");
		});

		it("should reject symlinks that resolve outside repository", async () => {
			const outsideFile = path.join(tempDir, "outside.ts");
			await fs.writeFile(outsideFile, "secrets");

			const linkPath = path.join(repoPath, "linked.ts");
			await fs.symlink(outsideFile, linkPath);

			const snippet = await extractSourceSnippet(repoPath, "linked.ts", 1, 1);
			expect(snippet).toContain("snippetUnavailable: Symlink target is outside");
		});

		it("should reject binary files", async () => {
			const binPath = path.join(repoPath, "bin.dat");
			await fs.writeFile(binPath, Buffer.from([0x00, 0x01, 0x02]));

			const snippet = await extractSourceSnippet(repoPath, "bin.dat", 1, 1);
			expect(snippet).toContain("snippetUnavailable: Binary file detected.");
		});
	});

	describe("buildReviewBundle", () => {
		it("should build input bundle correctly", async () => {
			const filePath = path.join(repoPath, "src/auth.ts");
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, "// line 1\nconst a = 1;");

			const dbFinding = await connection.db.query.findings.findFirst({
				where: (fields, { eq }) => eq(fields.id, findingId),
			});
			expect(dbFinding).toBeDefined();

			const bundle = await buildReviewBundle(connection.db, dbFinding!, repoPath);
			expect(bundle.finding.id).toBe(findingId);
			expect(bundle.scanContext.scanRunId).toBe(scanRunId);
			expect(bundle.evidences).toHaveLength(1);
			expect(bundle.sourceSnippet).toBe("const a = 1;");
		});
	});

	describe("run", () => {
		it("should succeed and save completed review using fixtureOutput", async () => {
			const mockReviewOutput = {
				summary: "This is a valid Slack token exposure.",
				likelyImpact: "Unauthorized Slack workspace access.",
				falsePositiveAssessment: {
					level: "low",
					reasoning: "The token has standard prefix and was tested.",
				},
				evidenceStrength: {
					level: "strong",
					reasoning: "Explicitly defined token matches pattern.",
				},
				remediationDirection: "Revoke token and store it in vault.",
				reviewerNotes: ["Observe hardcoded variable assignment."],
				confidenceAdjustment: "increase",
			};

			const fixturePath = path.join(tempDir, "mock-review.json");
			await fs.writeFile(fixturePath, JSON.stringify(mockReviewOutput));

			// Setup source code file
			const filePath = path.join(repoPath, "src/auth.ts");
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, "const slack = 'token';");

			const runner = new FindingReviewRunner(connection.db);
			const result = await runner.run(findingId, {
				fixtureOutput: fixturePath,
			});

			expect(result.ok).toBe(true);
			expect(result.status).toBe("completed");

			const reviewRow = await connection.db.query.findingReviews.findFirst({
				where: (fields, { eq }) => eq(fields.id, result.reviewId),
			});
			expect(reviewRow).toBeDefined();
			expect(reviewRow?.status).toBe("completed");
			expect(reviewRow?.summary).toBe("This is a valid Slack token exposure.");
			expect(reviewRow?.confidenceAdjustment).toBe("increase");
		});

		it("should succeed using mock LlmProvider", async () => {
			const mockResponse = {
				id: "resp-1",
				content: `Some conversational preamble...
\`\`\`json
{
  "summary": "Detected credentials.",
  "likelyImpact": "Vulnerability exposure.",
  "falsePositiveAssessment": {
    "level": "low",
    "reasoning": "Standard pattern."
  },
  "evidenceStrength": {
    "level": "strong",
    "reasoning": "Direct match."
  },
  "remediationDirection": "Remove key.",
  "reviewerNotes": ["Point 1"],
  "confidenceAdjustment": "unchanged"
}
\`\`\``,
			};

			const mockLlm: LlmProvider = {
				chatCompletion: vi.fn().mockResolvedValue(mockResponse),
			};

			// Setup source code file
			const filePath = path.join(repoPath, "src/auth.ts");
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, "const slack = 'token';");

			const runner = new FindingReviewRunner(connection.db, mockLlm);
			const result = await runner.run(findingId);

			expect(result.ok).toBe(true);
			expect(result.status).toBe("completed");

			const reviewRow = await connection.db.query.findingReviews.findFirst({
				where: (fields, { eq }) => eq(fields.id, result.reviewId),
			});
			expect(reviewRow?.status).toBe("completed");
			expect(reviewRow?.summary).toBe("Detected credentials.");
		});

		it("should save failed review on validation error or unconfigured provider", async () => {
			const runner = new FindingReviewRunner(connection.db); // no llmProvider

			// Setup source code file
			const filePath = path.join(repoPath, "src/auth.ts");
			await fs.mkdir(path.dirname(filePath), { recursive: true });
			await fs.writeFile(filePath, "const slack = 'token';");

			const result = await runner.run(findingId);
			expect(result.ok).toBe(false);
			expect(result.status).toBe("failed");
			expect(result.error).toContain("LLM provider is not configured");

			const reviewRow = await connection.db.query.findingReviews.findFirst({
				where: (fields, { eq }) => eq(fields.id, result.reviewId),
			});
			expect(reviewRow?.status).toBe("failed");
			expect(reviewRow?.errorMessage).toContain("LLM provider is not configured");
		});
	});
});
