import { readdirSync, readFileSync } from "node:fs";
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
import {
	type LlmProvider,
	LlmProviderExecutionError,
	type LlmResponse,
} from "../../providers/types";
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

function buildImprovementRequest(findingId: string) {
	return {
		title: "反射型 XSS 改善依頼",
		objective:
			"保存済みの scan evidence に基づき、ユーザー入力の出力時エスケープ不足を修正する。",
		scope: ["対象は scan bundle に含まれる finding と evidence に限定します。"],
		priorityPlan: [
			{
				priority: "high",
				rationale: "高 severity でユーザー入力が出力に到達しているため優先します。",
				findingIds: [findingId],
			},
		],
		implementationTasks: [
			{
				title: "出力エスケープを追加する",
				body: "該当箇所でユーザー入力を HTML として解釈されない形にエスケープし、同じ経路の回帰テストを追加してください。",
				findingIds: [findingId],
				evidenceRefs: ["src/app.ts:10"],
			},
		],
		acceptanceCriteria: [
			"ユーザー入力が HTML として実行されないことをテストで確認できる。",
		],
		verificationCommands: ["bun test"],
		constraints: ["保存済み evidence 以外の repository 状態を見た前提で書かない。"],
		nonGoals: ["新しい scanner や DAST 実行はこの依頼に含めない。"],
		handoffPrompt:
			"保存済み scan context に基づき、反射型 XSS finding を修正してください。対象範囲は bundle 内の finding と evidence に限定し、出力エスケープ追加、回帰テスト、bun test による検証を行ってください。新しい scanner 実装や repository 全体の自由探索は非ゴールです。",
	};
}

function buildValidReviewOutput(findingId: string) {
	return {
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
		improvementRequest: buildImprovementRequest(findingId),
	};
}

describe("ScanReviewRunner", () => {
	let connection: DbConnection;
	let scanRunId: string;
	let findingId: string;
	let projectId: string;
	let userId: string;

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
		userId = user.id;
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
		projectId = project.id;
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
		const content = JSON.stringify(buildValidReviewOutput(findingId));
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
		expect(row?.output).toMatchObject({
			improvementRequest: {
				title: "反射型 XSS 改善依頼",
				handoffPrompt: expect.stringContaining("保存済み scan context"),
			},
		});
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
		expect(messages[0].content).toContain("improvementRequest");
		expect(messages[0].content).toContain("handoffPrompt");
		expect(messages[1].content).toContain("レビュー本文は必ず日本語");
		expect(callOptions?.outputSchema).toEqual(
			expect.objectContaining({ type: "object" }),
		);
	});

	it("starts a review without waiting for the provider to complete", async () => {
		let resolveProvider: ((response: LlmResponse) => void) | undefined;
		const provider: LlmProvider = {
			chatCompletion: vi.fn(
				() =>
					new Promise<LlmResponse>((resolve) => {
						resolveProvider = resolve;
					}),
			),
		};
		const runner = new ScanReviewRunner(connection.db, provider);

		const started = await runner.start(scanRunId);

		expect(started.status).toBe("running");
		const runningRow = await connection.db.query.scanReviews.findFirst();
		expect(runningRow?.status).toBe("running");

		resolveProvider?.({
			id: "deferred-response",
			content: JSON.stringify(buildValidReviewOutput(findingId)),
		});
		const result = await started.completion;

		expect(result).toMatchObject({
			ok: true,
			reviewId: started.reviewId,
			status: "completed",
		});
		const completedRow = await connection.db.query.scanReviews.findFirst();
		expect(completedRow?.status).toBe("completed");
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
			improvementRequest: {
				...buildImprovementRequest(findingId),
				title: "Reflected XSS improvement request",
				objective: "Fix reflected XSS based on stored scan evidence.",
				scope: ["Only bundled scan evidence."],
				priorityPlan: [
					{
						priority: "high",
						rationale: "User input reaches output.",
						findingIds: [findingId],
					},
				],
				implementationTasks: [
					{
						title: "Patch escaping",
						body: "Escape user input and add regression tests.",
						findingIds: [findingId],
						evidenceRefs: ["src/app.ts:10"],
					},
				],
				acceptanceCriteria: ["HTML is not executed."],
				constraints: ["Use stored evidence only."],
				nonGoals: ["No scanner changes."],
				handoffPrompt: "Fix reflected XSS using stored scan context.",
			},
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

	it("drops triage hints for findings outside the scan bundle", async () => {
		const content = JSON.stringify({
			summary: "高リスクの finding が 1 件あります。",
			riskOverview: "保存済み証跡に基づく XSS リスクがあります。",
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
			improvementRequest: buildImprovementRequest(findingId),
		});
		const runner = new ScanReviewRunner(connection.db, providerWithContent(content));

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(true);
		const rows = await connection.db.select().from(scanReviews);
		expect(rows[0].status).toBe("completed");
		expect(rows[0].findingTriageHints).toEqual([]);
		expect(rows[0].confidenceNotes).toContain(
			"LLM 出力に bundle 外の finding ID が含まれていたため、安全のため参照から除外しました。",
		);
	});

	it("removes invalid improvement request finding references when valid references remain", async () => {
		const invalidFindingId = "00000000-0000-4000-8000-000000000000";
		const improvementRequest = buildImprovementRequest(findingId);
		improvementRequest.priorityPlan[0].findingIds.push(invalidFindingId);
		improvementRequest.implementationTasks[0].findingIds.push(invalidFindingId);
		const content = JSON.stringify({
			summary: "高リスクの finding が 1 件あります。",
			riskOverview: "保存済み証跡に基づく XSS リスクがあります。",
			priorityNotes: ["優先して確認してください。"],
			coverageNotes: ["証跡は static scan に限定されています。"],
			falsePositiveHotspots: ["明確な誤検知候補はありません。"],
			recommendedNextActions: ["出力時のエスケープ処理を追加してください。"],
			findingTriageHints: [
				{
					findingId,
					note: "bundle 内 finding の triage note です。",
					priority: "high",
				},
			],
			confidenceNotes: ["証跡は source-location に基づいています。"],
			improvementRequest,
		});
		const runner = new ScanReviewRunner(connection.db, providerWithContent(content));

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(true);
		const rows = await connection.db.select().from(scanReviews);
		expect(rows[0].status).toBe("completed");
		expect(
			(
				rows[0].output.improvementRequest as {
					priorityPlan: Array<{ findingIds: string[] }>;
					implementationTasks: Array<{ findingIds: string[] }>;
				}
			).priorityPlan[0].findingIds,
		).toEqual([findingId]);
		expect(
			(
				rows[0].output.improvementRequest as {
					priorityPlan: Array<{ findingIds: string[] }>;
					implementationTasks: Array<{ findingIds: string[] }>;
				}
			).implementationTasks[0].findingIds,
		).toEqual([findingId]);
	});

	it("rejects empty improvement request finding references when findings exist", async () => {
		const content = JSON.stringify({
			summary: "高リスクの finding が 1 件あります。",
			riskOverview: "保存済み証跡に基づく XSS リスクがあります。",
			priorityNotes: ["優先して確認してください。"],
			coverageNotes: ["証跡は static scan に限定されています。"],
			falsePositiveHotspots: ["明確な誤検知候補はありません。"],
			recommendedNextActions: ["出力時のエスケープ処理を追加してください。"],
			findingTriageHints: [
				{
					findingId,
					note: "bundle 内 finding の triage note です。",
					priority: "high",
				},
			],
			confidenceNotes: ["証跡は source-location に基づいています。"],
			improvementRequest: buildImprovementRequest(findingId),
		});
		const parsed = JSON.parse(content);
		parsed.improvementRequest.priorityPlan[0].findingIds = [];
		const runner = new ScanReviewRunner(
			connection.db,
			providerWithContent(JSON.stringify(parsed)),
		);

		const result = await runner.run(scanRunId);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("omitted finding references");
	});

	it("allows zero-finding handoff without fake finding IDs", async () => {
		const now = new Date("2026-06-26T01:00:00.000Z");
		const [zeroScan] = await connection.db
			.insert(scanRuns)
			.values({
				projectId,
				profile: "baseline",
				status: "completed",
				startedAt: now,
				completedAt: now,
				createdByUserId: userId,
				summary: "completed with zero findings",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		await connection.db.insert(toolRuns).values({
			scanRunId: zeroScan.id,
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
		const content = JSON.stringify({
			summary: "finding 0 件ですが、追加確認が必要です。",
			riskOverview: "finding 0 件は安全を証明しないため、カバレッジ確認が必要です。",
			priorityNotes: ["未検査領域の確認を優先してください。"],
			coverageNotes: ["保存済み scan bundle の範囲に限定されています。"],
			falsePositiveHotspots: [],
			recommendedNextActions: ["追加の自動診断対象を確認してください。"],
			findingTriageHints: [],
			confidenceNotes: ["証跡は scan metadata に限定されています。"],
			improvementRequest: {
				title: "Zero finding 追加確認依頼",
				objective:
					"finding 0 件の scan に対して、保存済み context に基づく追加確認を行う。",
				scope: ["finding 0 件のため、カバレッジ確認と不足診断を対象にします。"],
				priorityPlan: [
					{
						priority: "medium",
						rationale: "安全証明ではないため確認を継続します。",
						findingIds: [],
					},
				],
				implementationTasks: [
					{
						title: "未検査領域を確認する",
						body: "scan profile と tool metadata から不足している確認項目を洗い出してください。",
						findingIds: [],
						evidenceRefs: [],
					},
				],
				acceptanceCriteria: ["追加確認項目が明示されている。"],
				verificationCommands: ["bun test"],
				constraints: ["保存済み scan bundle の範囲だけを根拠にする。"],
				nonGoals: ["finding 0 件を安全証明として扱わない。"],
				handoffPrompt:
					"finding 0 件は安全を証明しません。保存済み scan bundle に基づき、カバレッジ確認、missing diagnostics、automated diagnostics follow-up を整理してください。",
			},
		});
		const runner = new ScanReviewRunner(connection.db, providerWithContent(content));

		const result = await runner.run(zeroScan.id);

		expect(result.ok).toBe(true);
		const rows = await connection.db.select().from(scanReviews);
		expect(rows.at(-1)?.status).toBe("completed");
	});
});
