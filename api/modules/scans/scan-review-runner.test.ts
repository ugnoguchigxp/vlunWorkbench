import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import { LlmProviderExecutionError, type LlmProvider } from "../../providers/types";
import { ScanReviewRunner } from "./scan-review-runner";

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		const sqlPath = path.resolve(migrationsDir, filename);
		connection.sqlite.exec(readFileSync(sqlPath, "utf8"));
	}
}

function providerWithContent(content: string): LlmProvider {
	return {
		chatCompletion: vi.fn(async () => ({
			id: "test-response",
			content,
		})),
	};
}

describe("ScanReviewRunner", () => {
	let connection: DbConnection;
	let scanRunId: string;
	let findingId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);

		const now = new Date("2026-06-26T00:00:00.000Z");
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "scan-review@example.com",
				passwordHash: "hash",
				displayName: "Scan Reviewer",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: user.id,
				name: "Target Project",
				repoPath: "/tmp/target",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [scanRun] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project.id,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: now,
				createdByUserId: user.id,
				summary: "completed",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scanRun.id;
		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "semgrep",
			toolVersion: "1.0.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			startedAt: now,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		});
		const [artifact] = await connection.db
			.insert(scanArtifacts)
			.values({
				scanRunId,
				kind: "raw_result",
				format: "json",
				path: "raw.json",
				sha256: "sha",
				sizeBytes: 10,
				createdAt: now,
			})
			.returning();
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId: project.id,
				sourceTool: "semgrep",
				ruleId: "javascript.lang.security.audit.xss",
				title: "Reflected XSS",
				description: "User input is written without escaping.",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/app.ts", startLine: 10 },
				fingerprint: "scan-review-finding",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingId = finding.id;
		await connection.db.insert(findingEvidences).values({
			findingId,
			kind: "source-location",
			title: "source",
			artifactId: artifact.id,
			location: { path: "src/app.ts", startLine: 10 },
			snippet: "res.send(req.query.name)",
			createdAt: now,
		});
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("persists a completed structured scan review", async () => {
		const content = JSON.stringify({
			summary: "高リスクの finding が 1 件あり、優先確認が必要です。",
			riskOverview:
				"ユーザー入力がエスケープされずに出力されるため、XSS リスクが残っています。",
			priorityNotes: ["反射型 XSS の修正を最優先にしてください。"],
			coverageNotes: ["現時点の証跡は static scan に限定されています。"],
			falsePositiveHotspots: ["明確な誤検知候補はありません。"],
			recommendedNextActions: ["出力時のエスケープ処理を追加してください。"],
			findingTriageHints: [
				{
					findingId,
					note: "ユーザー入力が出力に到達しているため、優先度は高いです。",
					priority: "high",
				},
			],
			confidenceNotes: ["証跡は source-location に基づいています。"],
		});
		const provider = providerWithContent(`\`\`\`json\n${content}\n\`\`\``);
		const runner = new ScanReviewRunner(connection.db, provider);

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(true);
		const row = await connection.db.query.scanReviews.findFirst();
		expect(row?.status).toBe("completed");
		expect(row?.summary).toBe(
			"高リスクの finding が 1 件あり、優先確認が必要です。",
		);
		expect(row?.findingTriageHints).toHaveLength(1);
		const messages = (
			provider.chatCompletion as unknown as {
				mock: { calls: Parameters<LlmProvider["chatCompletion"]>[] };
			}
		).mock.calls[0][0];
		const callOptions = (
			provider.chatCompletion as unknown as {
				mock: { calls: Parameters<LlmProvider["chatCompletion"]>[] };
			}
		).mock.calls[0][1];
		expect(messages[0].content).toContain("必ず日本語でレビュー");
		expect(messages[1].content).toContain("レビュー本文は必ず日本語");
		expect(callOptions?.outputSchema).toEqual(
			expect.objectContaining({ type: "object" }),
		);
	});

	it("rejects English-only scan review text", async () => {
		const content = JSON.stringify({
			summary: "One high risk finding needs review.",
			riskOverview: "The scan has a likely XSS issue.",
			priorityNotes: ["Fix reflected XSS first."],
			coverageNotes: ["Static scan evidence only."],
			falsePositiveHotspots: ["None obvious."],
			recommendedNextActions: ["Patch output escaping."],
			findingTriageHints: [
				{
					findingId,
					note: "High priority because user input reaches output.",
					priority: "high",
				},
			],
			confidenceNotes: ["Evidence is source-location based."],
		});
		const runner = new ScanReviewRunner(
			connection.db,
			providerWithContent(`\`\`\`json\n${content}\n\`\`\``),
		);

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("Japanese review text is required");
		const row = await connection.db.query.scanReviews.findFirst();
		expect(row?.status).toBe("failed");
	});

	it("classifies provider execution failures", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => {
				throw new LlmProviderExecutionError("codex failed");
			}),
		};
		const runner = new ScanReviewRunner(connection.db, provider);

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("llm_provider_execution_failed");
		const row = await connection.db.query.scanReviews.findFirst();
		expect(row?.status).toBe("failed");
		expect(row?.errorMessage).toBe(
			"llm_provider_execution_failed: codex failed",
		);
	});

	it("rejects triage hints for findings outside the scan bundle", async () => {
		const content = JSON.stringify({
			summary: "Invalid reference.",
			riskOverview: "Invalid reference.",
			priorityNotes: [],
			coverageNotes: [],
			falsePositiveHotspots: [],
			recommendedNextActions: [],
			findingTriageHints: [
				{
					findingId: "00000000-0000-4000-8000-000000000000",
					note: "Not in bundle.",
					priority: "high",
				},
			],
			confidenceNotes: [],
		});
		const runner = new ScanReviewRunner(connection.db, providerWithContent(content));

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("llm_structured_output_validation_failed");
		const rows = await connection.db.select().from(scanReviews);
		expect(rows[0].status).toBe("failed");
	});
});
