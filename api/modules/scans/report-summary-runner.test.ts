import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import {
	findings,
	projects,
	scanRuns,
	toolRuns,
	users,
} from "../../db/schema";
import {
	type LlmProvider,
	LlmProviderExecutionError,
} from "../../providers/types";
import { buildMarkdownReportWithLlmSummary } from "./report-summary-runner";

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

describe("buildMarkdownReportWithLlmSummary", () => {
	let connection: DbConnection;
	let scanRunId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const now = new Date("2026-06-26T00:00:00.000Z");
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "report-summary@example.com",
				passwordHash: "hash",
				displayName: "Reporter",
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
		await connection.db.insert(findings).values({
			scanRunId,
			projectId: project.id,
			sourceTool: "semgrep",
			ruleId: "rule.xss",
			title: "Reflected XSS",
			description: "User input is written without escaping.",
			severity: "high",
			confidence: "static",
			status: "open",
			primaryLocation: { path: "src/app.ts", startLine: 10 },
			fingerprint: "report-summary-finding",
			createdAt: now,
			updatedAt: now,
		});
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("inserts structured LLM summary into deterministic markdown", async () => {
		const output = JSON.stringify({
			executiveSummary:
				"このスキャンでは高リスクの finding が 1 件確認されています。",
			keyFindings: ["反射型 XSS が最優先の確認対象です。"],
			riskNarrative:
				"ユーザー入力がエスケープされずに出力される点に残存リスクがあります。",
			recommendedNextActions: ["出力時のエスケープ処理を修正してください。"],
			confidenceNotes: ["証跡は static scan に限定されています。"],
		});
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "summary-response",
				content: `\`\`\`json\n${output}\n\`\`\``,
			})),
		};

		const result = await buildMarkdownReportWithLlmSummary(connection.db, scanRunId, {
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
			title: "Security Report",
			llmProvider: provider,
		});

		expect(result.markdown).toContain("## LLMサマリ");
		expect(result.markdown).toContain(
			"このスキャンでは高リスクの finding が 1 件確認されています。",
		);
		expect(result.markdown.indexOf("## LLMサマリ")).toBeLessThan(
			result.markdown.indexOf("## スキャン概要"),
		);
		expect(result.systemContext).toEqual(
			expect.objectContaining({
				key: "scans.reportSummary",
				renderedHash: expect.stringMatching(/^sha256:/),
			}),
		);
		expect(result.promptMessages).toEqual([
			expect.objectContaining({
				key: "scans.reportSummary",
				messageRole: "system",
			}),
			expect.objectContaining({
				key: "scans.reportSummaryInput",
				messageRole: "user",
			}),
		]);
		expect(result.promptSequenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
		const messages = (
			provider.chatCompletion as unknown as {
				mock: { calls: Parameters<LlmProvider["chatCompletion"]>[] };
			}
		).mock.calls[0][0];
		expect(messages.map((message) => message.role)).toEqual([
			"system",
			"user",
		]);
		expect(messages[0].content).toContain("必ず日本語で書いてください");
		expect(messages[1].content).toContain("本文は必ず日本語");
		const options = (
			provider.chatCompletion as unknown as {
				mock: { calls: Parameters<LlmProvider["chatCompletion"]>[] };
			}
		).mock.calls[0][1];
		expect(options?.outputSchema).toEqual(
			expect.objectContaining({ type: "object" }),
		);
	});

	it("rejects English-only LLM report summary text", async () => {
		const output = JSON.stringify({
			executiveSummary: "LLM says the scan has one high risk finding.",
			keyFindings: ["Reflected XSS is the highest priority."],
			riskNarrative: "Residual risk is tied to unescaped user input.",
			recommendedNextActions: ["Fix escaping."],
			confidenceNotes: ["Static evidence only."],
		});
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "summary-response",
				content: `\`\`\`json\n${output}\n\`\`\``,
			})),
		};

		await expect(
			buildMarkdownReportWithLlmSummary(connection.db, scanRunId, {
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
				title: "Security Report",
				llmProvider: provider,
			}),
		).rejects.toThrow("Japanese review text is required");
	});

	it("classifies provider execution failures for report generation", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => {
				throw new LlmProviderExecutionError("codex failed");
			}),
		};

		await expect(
			buildMarkdownReportWithLlmSummary(connection.db, scanRunId, {
				includeFalsePositives: true,
				includeDeferred: true,
				includeUndecided: true,
				title: "Security Report",
				llmProvider: provider,
			}),
		).rejects.toThrow("llm_provider_execution_failed: codex failed");
	});
});
