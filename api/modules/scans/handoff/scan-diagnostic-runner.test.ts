import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../../db";
import {
	findingEvidences,
	findings,
	projects,
	scanArtifacts,
	scanDiagnosticRuns,
	scanReports,
	scanReviews,
	scanRuns,
	toolRuns,
	users,
} from "../../../db/schema";
import type { LlmProvider } from "../../../providers/types";
import { ScanReportRunner } from "../../reports/scan-report-runner";
import { ArtifactStorage } from "../artifact-storage";
import { ScanDiagnosticRunner } from "./scan-diagnostic-runner";
import { ScanReviewRunner } from "./scan-review-runner";

function applyMigrations(connection: DbConnection) {
	const migrationsDir = path.resolve(process.cwd(), "drizzle");
	for (const filename of readdirSync(migrationsDir)
		.filter((file) => file.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b))) {
		connection.sqlite.exec(
			readFileSync(path.resolve(migrationsDir, filename), "utf8"),
		);
	}
}

function validReviewOutput(findingId: string) {
	return {
		summary: "保存済み証跡から高リスクの finding を 1 件確認しました。",
		riskOverview:
			"ユーザー入力がエスケープされずに出力へ到達する可能性があります。",
		priorityNotes: ["対象 finding の修正を優先してください。"],
		coverageNotes: ["評価は保存済み static scan 証跡に限定されます。"],
		falsePositiveHotspots: ["実行時到達可能性は未確認です。"],
		recommendedNextActions: ["出力エスケープと回帰テストを追加してください。"],
		findingTriageHints: [
			{
				findingId,
				note: "保存済みデータフローに基づく高優先度の改善候補です。",
				priority: "high",
			},
		],
		findingAssessments: [
			{
				findingId,
				criticality: "high",
				criticalityRationale:
					"保存済み finding はユーザー入力の未エスケープ出力を示しています。",
				falsePositiveLikelihood: "low",
				exploitability: "possible",
				businessImpact:
					"利用者のブラウザで意図しないスクリプトが実行される可能性があります。",
				priority: "high",
				remediation:
					"出力時エスケープを追加し、同じ入力経路の回帰テストを実行してください。",
				evidenceRefs: [{ kind: "finding", id: findingId }],
				assumptions: ["保存済み finding のデータフローが正しいと仮定します。"],
				unknowns: ["実行時到達可能性は不明です。"],
			},
		],
		systemicRiskThemes: ["出力エンコード境界の統一が必要です。"],
		limitations: ["保存済み static scan 証跡だけに基づく評価です。"],
		confidenceNotes: ["実行時検証がないため確信度には制約があります。"],
		improvementRequest: {
			title: "出力エスケープ改善依頼",
			objective: "保存済み証跡に基づく XSS リスクを低減します。",
			scope: ["bundle 内の finding と evidence だけを対象にします。"],
			priorityPlan: [
				{
					priority: "high",
					rationale: "利用者への影響が想定されるため優先します。",
					findingIds: [findingId],
				},
			],
			implementationTasks: [
				{
					title: "出力エスケープを追加する",
					body: "対象出力へコンテキストに適したエスケープを追加します。",
					findingIds: [findingId],
					evidenceRefs: [`finding:${findingId}`],
				},
			],
			acceptanceCriteria: ["回帰テストでスクリプトが実行されないこと。"],
			verificationCommands: ["bun test"],
			constraints: ["保存済み証跡の範囲を越えて事実を補完しないこと。"],
			nonGoals: ["active scan の許可を変更しないこと。"],
			handoffPrompt:
				"保存済み scan context だけに基づき、対象 finding の出力エスケープと回帰テストを実装してください。",
		},
	};
}

describe("ScanDiagnosticRunner", () => {
	let connection: DbConnection;
	let artifactRoot: string;
	let scanRunId: string;
	let findingId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		applyMigrations(connection);
		artifactRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "vulnworkbench-diagnostic-runner-"),
		);
		const now = new Date("2026-07-30T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "diagnostic-runner@example.com",
				passwordHash: "hash",
				displayName: "Diagnostic runner",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId: owner.id,
				name: "Diagnostic fixture",
				repoPath: "/workspace/diagnostic-fixture",
				canonicalRepoPath: "/workspace/diagnostic-fixture",
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		const [scan] = await connection.db
			.insert(scanRuns)
			.values({
				projectId: project.id,
				profile: "source-baseline",
				status: "completed",
				createdByUserId: owner.id,
				startedAt: now,
				completedAt: now,
				metadata: { automaticDiagnosticRequested: true },
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scan.id;
		await connection.db.insert(toolRuns).values({
			scanRunId,
			toolName: "semgrep",
			toolVersion: "1.0.0",
			command: "semgrep scan",
			status: "completed",
			exitCode: 0,
			metadata: { adapter: "semgrep", reproducible: true },
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
				sha256: "a".repeat(64),
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
				fingerprint: "diagnostic-runner-finding",
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

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(artifactRoot, { recursive: true, force: true });
	});

	it("automatically persists an evidence-constrained review and report once", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "diagnostic-response",
				content: JSON.stringify(validReviewOutput(findingId)),
			})),
		};
		const reviewRunner = new ScanReviewRunner(connection.db, provider);
		const reportRunner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			concurrency: 1,
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner,
			reportRunner,
		});

		const first = await runner.run(scanRunId);
		const second = await runner.run(scanRunId);

		expect(first).toMatchObject({
			status: "completed",
			readiness: "ready",
			limitations: [],
		});
		expect(second.diagnosticRunId).toBe(first.diagnosticRunId);
		expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
		const diagnostics = await connection.db.select().from(scanDiagnosticRuns);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			status: "completed",
			readiness: "ready",
			attemptCount: 1,
		});
		expect(diagnostics[0].inputSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
		expect(diagnostics[0].scannerProvenanceHash).toMatch(/^[a-f0-9]{64}$/);
		const reviews = await connection.db.select().from(scanReviews);
		expect(reviews).toHaveLength(1);
		expect(reviews[0].output).toMatchObject({
			responseContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(reviews[0].inputBundle).toMatchObject({
			automatedDiagnostic: {
				diagnosticRunId: first.diagnosticRunId,
				inputSnapshotHash: diagnostics[0].inputSnapshotHash,
			},
		});
		const reports = await connection.db.select().from(scanReports);
		expect(reports).toHaveLength(1);
		expect(reports[0].options).toMatchObject({
			source: "automated-diagnostic",
			diagnosticRunId: first.diagnosticRunId,
			readiness: "ready",
		});
		const reportArtifact = await connection.db.query.scanArtifacts.findFirst({
			where: (fields, { eq }) => eq(fields.id, reports[0].artifactId ?? ""),
		});
		const markdown = await fs.readFile(
			path.resolve(artifactRoot, reportArtifact?.path ?? ""),
			"utf8",
		);
		expect(markdown).toContain("## LLM Criticality Assessment");
		expect(markdown).toContain(`finding:${findingId}`);
	});

	it("runs terminal post-processing during recovery", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "diagnostic-recovery-response",
				content: JSON.stringify(validReviewOutput(findingId)),
			})),
		};
		let resolveCompleted: (() => void) | undefined;
		const completed = new Promise<void>((resolve) => {
			resolveCompleted = resolve;
		});
		const onCompletedDiagnostic = vi.fn(async () => {
			resolveCompleted?.();
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner: new ScanReviewRunner(connection.db, provider),
			reportRunner: new ScanReportRunner(connection.db, {
				artifactStorage: new ArtifactStorage(artifactRoot),
				concurrency: 1,
			}),
			onCompletedDiagnostic,
		});

		await runner.recover();
		await completed;
		expect(onCompletedDiagnostic).toHaveBeenCalledWith(
			scanRunId,
			expect.objectContaining({ status: "completed" }),
		);
		await runner.shutdown();
	});

	it("deduplicates concurrent terminal post-processing for one diagnostic", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "diagnostic-deduplication-response",
				content: JSON.stringify(validReviewOutput(findingId)),
			})),
		};
		const initialRunner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner: new ScanReviewRunner(connection.db, provider),
			reportRunner: new ScanReportRunner(connection.db, {
				artifactStorage: new ArtifactStorage(artifactRoot),
				concurrency: 1,
			}),
		});
		await initialRunner.run(scanRunId);

		let releaseHook!: () => void;
		const hookMayFinish = new Promise<void>((resolve) => {
			releaseHook = resolve;
		});
		let notifyHookStarted!: () => void;
		const hookStarted = new Promise<void>((resolve) => {
			notifyHookStarted = resolve;
		});
		const onCompletedDiagnostic = vi.fn(async () => {
			notifyHookStarted();
			await hookMayFinish;
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner: new ScanReviewRunner(connection.db, provider),
			reportRunner: new ScanReportRunner(connection.db, {
				artifactStorage: new ArtifactStorage(artifactRoot),
				concurrency: 1,
			}),
			onCompletedDiagnostic,
		});

		const first = runner.run(scanRunId);
		const second = runner.run(scanRunId);
		await hookStarted;
		expect(onCompletedDiagnostic).toHaveBeenCalledTimes(1);
		releaseHook();
		await expect(Promise.all([first, second])).resolves.toHaveLength(2);
		expect(onCompletedDiagnostic).toHaveBeenCalledTimes(1);
	});

	it("waits for recovery post-processing during shutdown", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "diagnostic-shutdown-response",
				content: JSON.stringify(validReviewOutput(findingId)),
			})),
		};
		let releaseHook!: () => void;
		const hookMayFinish = new Promise<void>((resolve) => {
			releaseHook = resolve;
		});
		let notifyHookStarted!: () => void;
		const hookStarted = new Promise<void>((resolve) => {
			notifyHookStarted = resolve;
		});
		const onCompletedDiagnostic = vi.fn(async () => {
			notifyHookStarted();
			await hookMayFinish;
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner: new ScanReviewRunner(connection.db, provider),
			reportRunner: new ScanReportRunner(connection.db, {
				artifactStorage: new ArtifactStorage(artifactRoot),
				concurrency: 1,
			}),
			onCompletedDiagnostic,
		});

		await runner.recover();
		await hookStarted;
		expect(onCompletedDiagnostic).toHaveBeenCalledTimes(1);
		let shutdownCompleted = false;
		const shutdown = runner.shutdown().then(() => {
			shutdownCompleted = true;
		});
		await Promise.resolve();
		expect(shutdownCompleted).toBe(false);
		releaseHook();
		await shutdown;
		expect(shutdownCompleted).toBe(true);
	});

	it("finishes with a deterministic report when the LLM is unavailable", async () => {
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => {
				throw new Error("LLM provider is not configured");
			}),
		};
		const reviewRunner = new ScanReviewRunner(connection.db, provider);
		const reportRunner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			concurrency: 1,
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner,
			reportRunner,
		});

		const result = await runner.run(scanRunId);

		expect(result).toMatchObject({
			status: "completed_with_limitations",
			readiness: "ready_with_limitations",
			limitations: ["llm_unavailable"],
		});
		const [diagnostic] = await connection.db.select().from(scanDiagnosticRuns);
		expect(diagnostic.scanReportId).not.toBeNull();
		const [report] = await connection.db.select().from(scanReports);
		expect(report.status).toBe("completed");
	});

	it("marks exploratory scanner input as ready only with limitations", async () => {
		await connection.db
			.update(toolRuns)
			.set({
				metadata: {
					adapter: "semgrep",
					provenance: {
						reproducible: false,
						configSource: "semgrep-registry-auto",
					},
				},
			})
			.where(eq(toolRuns.scanRunId, scanRunId));
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => ({
				id: "diagnostic-exploratory-response",
				content: JSON.stringify(validReviewOutput(findingId)),
			})),
		};
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner: new ScanReviewRunner(connection.db, provider),
			reportRunner: new ScanReportRunner(connection.db, {
				artifactStorage: new ArtifactStorage(artifactRoot),
				concurrency: 1,
			}),
		});

		await expect(runner.run(scanRunId)).resolves.toMatchObject({
			status: "completed_with_limitations",
			readiness: "ready_with_limitations",
			limitations: ["scanner_input_non_reproducible"],
		});
	});

	it("retries only the failed LLM stage and creates an assessed report revision", async () => {
		let available = false;
		const provider: LlmProvider = {
			chatCompletion: vi.fn(async () => {
				if (!available) throw new Error("LLM provider is not configured");
				return {
					id: "diagnostic-retry-response",
					content: JSON.stringify(validReviewOutput(findingId)),
				};
			}),
		};
		const reviewRunner = new ScanReviewRunner(connection.db, provider);
		const reportRunner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			concurrency: 1,
		});
		const runner = new ScanDiagnosticRunner(connection.db, {
			reviewRunner,
			reportRunner,
		});
		const first = await runner.run(scanRunId);

		available = true;
		const retry = await runner.retry(scanRunId);
		const second = await retry.completion;

		expect(second).toMatchObject({
			diagnosticRunId: first.diagnosticRunId,
			status: "completed",
			readiness: "ready",
		});
		const [diagnostic] = await connection.db.select().from(scanDiagnosticRuns);
		expect(diagnostic.attemptCount).toBe(2);
		expect(await connection.db.select().from(scanReviews)).toHaveLength(2);
		const reports = await connection.db.select().from(scanReports);
		expect(reports).toHaveLength(2);
		expect(
			reports.some(
				(report) =>
					(report.options as Record<string, unknown>).source ===
					"automated-diagnostic",
			),
		).toBe(true);
		const assessedReport = reports.find(
			(report) =>
				typeof (report.options as Record<string, unknown>).scanReviewId ===
				"string",
		);
		expect(assessedReport?.options).toMatchObject({
			scanReviewId: expect.any(String),
			provider: expect.any(String),
			model: expect.any(String),
			promptSequenceHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			responseContentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
	});
});
