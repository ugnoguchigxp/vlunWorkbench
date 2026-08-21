import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanImprovementRequest } from "../../../../shared/schemas/scan.schema";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	findings,
	projects,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../../db/schema";
import type { LlmProvider, LlmResponse } from "../../../providers/types";
import {
	parseChunkImprovementRequest,
	StructuredImprovementRequestError,
} from "./scan-improvement-request-builder";
import {
	mergeScanImprovementRequests,
	ScanImprovementRequestRunner,
} from "./scan-improvement-request-runner";
import type { ScanReviewBundle } from "./scan-review-bundle";

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	const sqlFiles = readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b));
	for (const filename of sqlFiles) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDir, filename), "utf8"),
		);
	}
}

const findingId = (index: number) =>
	`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

function bundle(
	ids: string[],
	totalFindings: number,
	findingOffset: number,
): ScanReviewBundle {
	return {
		project: { id: "project-1", name: "対象プロジェクト", defaultBranch: "main" },
		findings: ids.map((id) => ({ id })),
		limits: {
			totalFindings,
			filteredFindings: totalFindings,
			includedFindings: ids.length,
			findingOffset,
			maxFindings: 50,
			maxEvidencePerFinding: 2,
			maxSnippetChars: 300,
			maxDescriptionChars: 400,
			findingFilter: "all",
		},
	} as unknown as ScanReviewBundle;
}

function request(ids: string[], suffix: string): ScanImprovementRequest {
	return {
		title: `改修依頼 ${suffix}`,
		objective: "保存済み証跡に基づき、検出結果を修正する。",
		scope: ["このチャンクに含まれる finding を対象にする。"],
		priorityPlan: ids.length
			? [
					{
						priority: "high",
						rationale: "重大度の高い検出結果を優先する。",
						findingIds: ids,
					},
				]
			: [],
		implementationTasks: [
			{
				title: `検出結果を修正する ${suffix}`,
				body: "保存済み証跡を確認し、実装修正と回帰テストを追加する。",
				findingIds: ids,
				evidenceRefs: [],
			},
		],
		acceptanceCriteria: ["対象 finding の修正をテストで確認できる。"],
		verificationCommands: ["bun test"],
		constraints: ["保存済み context だけを根拠にする。"],
		nonGoals: ["新しい scanner の追加は対象外とする。"],
		handoffPrompt: "保存済み証跡に基づいて検出結果を修正してください。",
	};
}

function issueRequest(issueIds: string[], suffix: string) {
	return {
		title: `改修依頼 ${suffix}`,
		objective: "保存済み証跡に基づき、検出結果を修正する。",
		scope: ["このチャンクに含まれる issue を対象にする。"],
		priorityPlan: issueIds.length
			? [
					{
						priority: "high",
						rationale: "重大度の高い検出結果を優先する。",
						issueIds,
					},
				]
			: [],
		implementationTasks: [
			{
				title: `検出結果を修正する ${suffix}`,
				body: "保存済み証跡を確認し、実装修正と回帰テストを追加する。",
				issueIds,
				evidenceRefs: [],
			},
		],
		acceptanceCriteria: ["対象 issue の修正をテストで確認できる。"],
		verificationCommands: ["bun test"],
		constraints: ["保存済み context だけを根拠にする。"],
		nonGoals: ["新しい scanner の追加は対象外とする。"],
		handoffPrompt: "保存済み証跡に基づいて検出結果を修正してください。",
	};
}

function issueIdsFromPrompt(messages: Array<{ content: string }>): string[] {
	return [
		...new Set(
			messages.flatMap((message) =>
				[...message.content.matchAll(/"issueId"\s*:\s*"([0-9a-f-]{36})"/gi)].map(
					(match) => match[1] as string,
				),
			),
		),
	];
}

describe("mergeScanImprovementRequests", () => {
	it("covers every finding when more than 50 findings are split into chunks", () => {
		const ids = Array.from({ length: 51 }, (_, index) => findingId(index + 1));
		const firstIds = ids.slice(0, 50);
		const secondIds = ids.slice(50);

		const merged = mergeScanImprovementRequests(
			[bundle(firstIds, ids.length, 0), bundle(secondIds, ids.length, 50)],
			[request(firstIds, "前半"), request(secondIds, "後半")],
		);

		const covered = new Set(
			merged.implementationTasks.flatMap((task) => task.findingIds),
		);
		expect([...covered].sort()).toEqual([...ids].sort());
		expect(merged.scope[0]).toContain("全 51 件");
		expect(merged.handoffPrompt).toContain("全 51 件");
	});

	it("creates a coverage-oriented request for a zero-finding scan", () => {
		const merged = mergeScanImprovementRequests(
			[bundle([], 0, 0)],
			[request([], "ゼロ件")],
		);

		expect(merged.objective).toContain("安全宣言にせず");
		expect(merged.nonGoals).toContain(
			"finding 0 件を安全の証明として扱わないこと。",
		);
		expect(
			merged.implementationTasks.every((task) => task.findingIds.length === 0),
		).toBe(true);
	});

	it("fills missing tasks and a missing priority plan from saved finding IDs", () => {
		const ids = [findingId(1), findingId(2)];
		const incomplete = request([ids[0]], "一部");
		incomplete.priorityPlan = [];

		const merged = mergeScanImprovementRequests(
			[bundle(ids, ids.length, 0)],
			[incomplete],
		);

		expect(
			new Set(merged.implementationTasks.flatMap((task) => task.findingIds)),
		).toEqual(new Set(ids));
		expect(merged.priorityPlan).toEqual([
			expect.objectContaining({
				priority: "medium",
				findingIds: ids,
			}),
		]);
	});
});

describe("parseChunkImprovementRequest", () => {
	it("accepts only evidence IDs or locations present in the saved bundle", () => {
		const id = findingId(1);
		const savedBundle = {
			...bundle([id], 1, 0),
			artifacts: [],
			findings: [
				{
					id,
					primaryLocation: { path: "src/app.ts", startLine: 10 },
					evidence: [],
				},
			],
		} as unknown as ScanReviewBundle;
		const valid = request([id], "証跡");
		valid.implementationTasks[0]!.evidenceRefs = ["src/app.ts:10"];
		expect(
			parseChunkImprovementRequest(JSON.stringify(valid), savedBundle),
		).toEqual(valid);

		const invalid = structuredClone(valid);
		invalid.implementationTasks[0]!.evidenceRefs = ["src/invented.ts:99"];
		expect(() =>
			parseChunkImprovementRequest(JSON.stringify(invalid), savedBundle),
		).toThrow(StructuredImprovementRequestError);
	});
});

describe("ScanImprovementRequestRunner", () => {
	let connection: DbConnection;
	let scanRunId: string;
	let findingUuid: string;
	let userId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		const now = new Date("2026-08-21T00:00:00.000Z");
		const [user] = await connection.db
			.insert(users)
			.values({
				email: "improvement-request@example.com",
				passwordHash: "hash",
				displayName: "Improvement Request User",
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
		const [finding] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId: project.id,
				sourceTool: "semgrep",
				ruleId: "security.test",
				title: "検証用 finding",
				description: "保存済みの検証用 finding です。",
				severity: "high",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "src/app.ts", startLine: 10 },
				fingerprint: "improvement-request-finding",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		findingUuid = finding.id;
	});

	afterEach(() => {
		connection.sqlite.close();
	});

	it("persists an all-finding request with complete coverage metadata", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async (messages) => ({
				id: "improvement-response",
				content: JSON.stringify(issueRequest(issueIdsFromPrompt(messages), "全件")),
			})),
		};
		const runner = new ScanImprovementRequestRunner(connection.db, provider);

		const started = await runner.start(scanRunId, {
			createdByUserId: userId,
		});
		const completed = await started.completion;

		expect(completed.ok).toBe(true);
		expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
		const row = await connection.db.query.scanReviews.findFirst();
		expect(row?.status).toBe("completed");
		expect(row?.inputBundle).toMatchObject({
			generationKind: "improvement_request",
			limits: {
				totalIssues: 1,
				totalFindings: 1,
				includedIssues: 1,
				chunkCount: 1,
			},
		});
		expect(row?.output).toMatchObject({
			generationKind: "improvement_request",
			coverage: {
				totalIssues: 1,
				coveredIssues: 1,
				totalFindings: 1,
				coveredFindings: 1,
				chunkCount: 1,
			},
			improvementRequest: {
				implementationTasks: [
					expect.objectContaining({ findingIds: [findingUuid] }),
				],
			},
		});
	});

	it("passes one issue, not duplicate raw findings, to the improvement LLM", async () => {
		const [scan] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId));
		const [duplicate] = await connection.db
			.insert(findings)
			.values({
				scanRunId,
				projectId: scan.projectId,
				sourceTool: "trivy",
				ruleId: "CVE-2020-8203",
				title: "lodash vulnerability",
				description: "dependency advisory",
				severity: "critical",
				confidence: "static",
				status: "open",
				primaryLocation: { path: "package-lock.json" },
				fingerprint: "duplicate-dependency-finding",
				metadata: {
					type: "npm",
					packageName: "lodash",
					installedVersion: "4.17.20",
					target: "package-lock.json",
					vulnerabilityId: "CVE-2020-8203",
					aliases: ["GHSA-ABCD-1234-EFGH"],
				},
				createdAt: new Date("2026-08-21T00:00:00.000Z"),
				updatedAt: new Date("2026-08-21T00:00:00.000Z"),
			})
			.returning();
		await connection.db
			.update(findings)
			.set({
				sourceTool: "osv",
				ruleId: "GHSA-ABCD-1234-EFGH",
				primaryLocation: { path: "package-lock.json" },
				metadata: {
					ecosystem: "npm",
					packageName: "lodash",
					packageVersion: "4.17.20",
					manifestPath: "package-lock.json",
					advisoryId: "GHSA-ABCD-1234-EFGH",
					aliases: ["CVE-2020-8203"],
				},
			})
			.where(eq(findings.id, findingUuid));
		let promptContent = "";
		const provider: LlmProvider = {
			chatCompletion: vi.fn(
				async (messages: Parameters<LlmProvider["chatCompletion"]>[0]) => {
					promptContent = messages.map((message) => message.content).join("\n");
				return {
					id: "deduplicated-issue-response",
					content: JSON.stringify(
						issueRequest(issueIdsFromPrompt(messages), "重複統合"),
					),
				};
				},
			),
		};
		const runner = new ScanImprovementRequestRunner(connection.db, provider);

		const completed = await (
			await runner.start(scanRunId, { createdByUserId: userId })
		).completion;

		expect(completed.ok).toBe(true);
		expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
		expect(issueIdsFromPrompt([{ content: promptContent }])).toHaveLength(1);
		expect(
			[findingUuid, duplicate.id].filter((id) => promptContent.includes(id)),
		).toHaveLength(1);
		const row = await connection.db.query.scanReviews.findFirst();
		expect(row?.output).toMatchObject({
			coverage: { totalIssues: 1, totalFindings: 2 },
			improvementRequest: {
				implementationTasks: [
					expect.objectContaining({
						findingIds: expect.arrayContaining([findingUuid, duplicate.id]),
					}),
				],
			},
		});
	});

	it("deduplicates simultaneous generation requests for the same scan", async () => {
		let resolveProvider!: (response: LlmResponse) => void;
		let capturedIssueIds: string[] = [];
		const providerResponse = new Promise<LlmResponse>((resolve) => {
			resolveProvider = resolve;
		});
		const provider: LlmProvider = {
			chatCompletion: vi.fn((messages) => {
				capturedIssueIds = issueIdsFromPrompt(messages);
				return providerResponse;
			}),
		};
		const runner = new ScanImprovementRequestRunner(connection.db, provider);

		const [first, second] = await Promise.all([
			runner.start(scanRunId, { createdByUserId: userId }),
			runner.start(scanRunId, { createdByUserId: userId }),
		]);

		expect(second.reviewId).toBe(first.reviewId);
		expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
		resolveProvider({
			id: "deduplicated-response",
			content: JSON.stringify(issueRequest(capturedIssueIds, "重複防止")),
		});
		const [firstResult, secondResult] = await Promise.all([
			first.completion,
			second.completion,
		]);
		expect(firstResult.ok).toBe(true);
		expect(secondResult.ok).toBe(true);
		expect(await connection.db.select().from(scanReviews)).toHaveLength(1);
	});

	it("marks an interrupted request failed during recovery", async () => {
		const [scan] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId));
		const [interrupted] = await connection.db
			.insert(scanReviews)
			.values({
				scanRunId,
				projectId: scan.projectId,
				provider: "configured",
				model: "test-model",
				status: "running",
				inputBundle: { generationKind: "improvement_request" },
				createdByUserId: userId,
				startedAt: new Date("2026-08-21T00:00:00.000Z"),
				createdAt: new Date("2026-08-21T00:00:00.000Z"),
				updatedAt: new Date("2026-08-21T00:00:00.000Z"),
			})
			.returning();
		const runner = new ScanImprovementRequestRunner(connection.db, {
			chatCompletion: vi.fn(),
		});

		await expect(runner.recover()).resolves.toBe(1);
		const recovered = await connection.db.query.scanReviews.findFirst({
			where: (fields, { eq }) => eq(fields.id, interrupted.id),
		});
		expect(recovered).toMatchObject({
			status: "failed",
			errorMessage:
				"Improvement request execution was interrupted by a server restart.",
		});
	});

	it("waits for active generation during shutdown", async () => {
		let resolveProvider!: (response: LlmResponse) => void;
		let capturedIssueIds: string[] = [];
		const providerResponse = new Promise<LlmResponse>((resolve) => {
			resolveProvider = resolve;
		});
		const runner = new ScanImprovementRequestRunner(connection.db, {
			chatCompletion: vi.fn((messages) => {
				capturedIssueIds = issueIdsFromPrompt(messages);
				return providerResponse;
			}),
		});
		const started = await runner.start(scanRunId, {
			createdByUserId: userId,
		});
		let shutdownCompleted = false;
		const shutdown = runner.shutdown().then(() => {
			shutdownCompleted = true;
		});
		await Promise.resolve();
		expect(shutdownCompleted).toBe(false);

		resolveProvider({
			id: "shutdown-response",
			content: JSON.stringify(issueRequest(capturedIssueIds, "終了待機")),
		});
		await expect(started.completion).resolves.toMatchObject({ ok: true });
		await shutdown;
		expect(shutdownCompleted).toBe(true);
	});

	it("sends more than 50 findings in bounded chunks and persists full coverage", async () => {
		const now = new Date("2026-08-21T00:00:00.000Z");
		const [scanRun] = await connection.db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId));
		const extraFindings = await connection.db
			.insert(findings)
			.values(
				Array.from({ length: 50 }, (_, index) => ({
					scanRunId,
					projectId: scanRun.projectId,
					sourceTool: "semgrep",
					ruleId: `security.test.${index}`,
					title: `検証用 finding ${index}`,
					description: "保存済みの検証用 finding です。",
					severity: "high" as const,
					confidence: "static" as const,
					status: "open" as const,
					primaryLocation: {
						path: `src/generated-${String(index).padStart(3, "0")}.ts`,
						startLine: 10,
					},
					fingerprint: `improvement-request-finding-${index}`,
					createdAt: now,
					updatedAt: now,
				})),
			)
			.returning();
		const orderedIds = [findingUuid, ...extraFindings.map((finding) => finding.id)];
		let callIndex = 0;
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async (messages) => {
				callIndex += 1;
				return {
					id: `chunk-${callIndex}`,
					content: JSON.stringify(
						issueRequest(issueIdsFromPrompt(messages), `分割 ${callIndex}`),
					),
				};
			}),
		};
		const runner = new ScanImprovementRequestRunner(connection.db, provider);

		const started = await runner.start(scanRunId, {
			createdByUserId: userId,
		});
		const completed = await started.completion;

		expect(completed.ok).toBe(true);
		expect(provider.chatCompletion).toHaveBeenCalledTimes(2);
		const row = await connection.db.query.scanReviews.findFirst();
		const output = row?.output as
			| {
					coverage?: { totalFindings?: number; chunkCount?: number };
					improvementRequest?: ScanImprovementRequest;
			  }
			| undefined;
		expect(output?.coverage).toMatchObject({
			totalFindings: 51,
			chunkCount: 2,
		});
		expect(
			new Set(
				output?.improvementRequest?.implementationTasks.flatMap(
					(task) => task.findingIds,
				) ?? [],
			),
		).toEqual(new Set(orderedIds));
	});
});
