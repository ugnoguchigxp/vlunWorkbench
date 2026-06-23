import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createDbConnection, type DbConnection } from "../../db";
import {
	users,
	projects,
	scanRuns,
	toolRuns,
	findings,
	findingEvidences,
	findingReviews,
	findingDecisions,
	scanArtifacts,
} from "../../db/schema";
import { buildMarkdownReport } from "./report-builder";

describe("Report Builder", () => {
	let connection: DbConnection;
	let userId: string;
	let projectId: string;
	let scanRunId: string;
	let findingId1: string;
	let findingId2: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");

		// Apply migrations
		const migrationsDir = path.resolve(process.cwd(), "drizzle");
		const sqlFiles = readdirSync(migrationsDir)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		for (const filename of sqlFiles) {
			const sqlPath = path.resolve(migrationsDir, filename);
			const sql = readFileSync(sqlPath, "utf8");
			connection.sqlite.exec(sql);
		}

		// Seed user
		const now = new Date("2026-06-23T12:00:00.000Z");
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "reporter@example.com",
				passwordHash: "password",
				displayName: "Reporter User",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		userId = user.id;

		// Seed project
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: userId,
				name: "Target Project",
				repoPath: "/path/to/target",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		projectId = project.id;

		// Seed scan run
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: new Date(now.getTime() + 5000),
				createdByUserId: userId,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun.id;

		// Seed tool run
		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "Semgrep",
			toolVersion: "1.0.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: now,
			completedAt: new Date(now.getTime() + 4000),
			createdAt: now,
			updatedAt: now,
		});

		// Seed artifact
		const [artifact] = await connection.db.insert(scanArtifacts).values({
			scanRunId,
			kind: "raw_result",
			format: "json",
			path: "raw/results.json",
			sha256: "fake-sha",
			sizeBytes: 1234,
			createdAt: now,
		}).returning();

		// Seed findings
		const [f1] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "Semgrep",
				ruleId: "rules.xss",
				title: "Reflected XSS",
				description: "User input is printed without escaping",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/app.js", startLine: 12 },
				fingerprint: "fp1",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId1 = f1.id;

		const [f2] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId,
				sourceTool: "Semgrep",
				ruleId: "rules.sqli",
				title: "SQL Injection",
				description: "Raw SQL query query",
				severity: "critical",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/db.js", startLine: 45 },
				fingerprint: "fp2",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId2 = f2.id;

		// Seed evidence
		await connection.db.insert(findingEvidences).values({
			findingId: findingId1,
			kind: "source-location",
			title: "xss vulnerability source location",
			artifactId: artifact.id,
			location: { path: "src/app.js", startLine: 12 },
			snippet: "res.send(req.query.name);",
			createdAt: now,
		});

		// Seed review
		await connection.db.insert(findingReviews).values({
			findingId: findingId1,
			provider: "openai",
			model: "gpt-4",
			status: "completed",
			summary: "LLM confirmed XSS vulnerability.",
			likelyImpact: "Attacker can execute arbitrary JS.",
			falsePositiveAssessment: { level: "low", reasoning: "Code prints name directly." },
			evidenceStrength: { level: "strong", reasoning: "Explicit source/sink matches." },
			remediationDirection: "Sanitize or use templates.",
			reviewerNotes: ["Checked index.js too."],
			confidenceAdjustment: "unchanged",
			createdAt: now,
			updatedAt: now,
		});

		// Seed decision (f1: needs_fix, f2: undecided)
		await connection.db.insert(findingDecisions).values({
			findingId: findingId1,
			decision: "needs_fix",
			reason: "confirmed_by_review",
			comment: "Will patch immediately.",
			createdAt: now,
			updatedAt: now,
		});
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("generates a deterministic report markdown", async () => {
		const options = {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Custom Security Report",
		};

		const report1 = await buildMarkdownReport(connection.db, scanRunId, options);
		const report2 = await buildMarkdownReport(connection.db, scanRunId, options);

		expect(report1).toBe(report2); // Deterministic

		// Content checks
		expect(report1).toContain("# Custom Security Report");
		expect(report1).toContain("## Scan Summary");
		expect(report1).toContain("## Tool Summary");
		expect(report1).toContain("## Decision Summary");
		expect(report1).toContain("## Accepted / Needs Fix Findings");
		expect(report1).toContain("### Finding " + findingId1);
		expect(report1).toContain("- **Severity:** high");
		expect(report1).toContain("LLM confirmed XSS vulnerability.");
		expect(report1).toContain("## Undecided Findings");
		expect(report1).toContain("### Finding " + findingId2);
		expect(report1).toContain("- **Severity:** critical");
	});

	it("uses the latest completed review as report content", async () => {
		const now = new Date("2026-06-23T12:00:00.000Z");
		await connection.db.insert(findingReviews).values({
			findingId: findingId1,
			provider: "openai",
			model: "gpt-4.1",
			status: "failed",
			summary: null,
			likelyImpact: null,
			falsePositiveAssessment: null,
			evidenceStrength: null,
			remediationDirection: null,
			reviewerNotes: null,
			confidenceAdjustment: "unknown",
			errorMessage: "Provider unavailable",
			createdAt: new Date(now.getTime() + 1000),
			updatedAt: new Date(now.getTime() + 1000),
		});

		const report = await buildMarkdownReport(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Review Selection Report",
		});

		expect(report).toContain("LLM confirmed XSS vulnerability.");
		expect(report).toContain("Review ID:");
		expect(report).toContain("Status: failed");
		expect(report).not.toContain("- **Error Message:** Provider unavailable");
	});

	it("respects exclusion options", async () => {
		const options = {
			includeFalsePositives: false,
			includeDeferred: false,
			includeUndecided: false,
			title: "Filtered Report",
		};

		const report = await buildMarkdownReport(connection.db, scanRunId, options);

		expect(report).toContain("## Accepted / Needs Fix Findings");
		expect(report).toContain("### Finding " + findingId1);

		expect(report).toContain("## Undecided Findings");
		expect(report).toContain("Section excluded by report options.");
		expect(report).not.toContain("### Finding " + findingId2);
	});
});
