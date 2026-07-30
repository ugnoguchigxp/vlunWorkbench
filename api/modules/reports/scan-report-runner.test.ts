import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbConnection, type DbConnection } from "../../db";
import { projects, scanArtifacts, scanReports, scanRuns, users } from "../../db/schema";
import type { LlmRouter } from "../../providers/llmRouter";
import { ArtifactStorage } from "../scans/artifact-storage";
import { ScanReportRepository } from "../scans/report-repository";
import { ScanReportRunner } from "./scan-report-runner";

describe("ScanReportRunner", () => {
	let connection: DbConnection;
	let artifactRoot: string;
	let scanRunId: string;
	let ownerUserId: string;

	beforeEach(async () => {
		connection = createDbConnection(":memory:");
		const migrationsDirectory = path.resolve(process.cwd(), "drizzle");
		for (const filename of readdirSync(migrationsDirectory)
			.filter((file) => file.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b))) {
			connection.sqlite.exec(
				readFileSync(path.resolve(migrationsDirectory, filename), "utf8"),
			);
		}
		artifactRoot = await fs.mkdtemp(
			path.join(os.tmpdir(), "vulnworkbench-report-runner-"),
		);

		const now = new Date("2026-07-30T00:00:00.000Z");
		const [owner] = await connection.db
			.insert(users)
			.values({
				email: "report-runner@example.com",
				passwordHash: "hash",
				displayName: "Report runner",
				role: "member",
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		ownerUserId = owner.id;
		const [project] = await connection.db
			.insert(projects)
			.values({
				ownerUserId,
				name: "Report fixture",
				repoPath: "/workspace/report-fixture",
				canonicalRepoPath: "/workspace/report-fixture",
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
				createdByUserId: ownerUserId,
				startedAt: now,
				completedAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		scanRunId = scan.id;
	});

	afterEach(async () => {
		connection.sqlite.close();
		await fs.rm(artifactRoot, { recursive: true, force: true });
	});

	it("returns queued immediately, generates in the background, and persists integrity metadata", async () => {
		const runner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			concurrency: 1,
		});

		const started = await runner.start({
			scanRunId,
			title: "NightWorkers security report",
			summaryMode: "deterministic",
			generatedByUserId: ownerUserId,
		});

		expect(started.status).toBe("queued");
		expect(await started.completion).toEqual({
			reportId: started.reportId,
			status: "completed",
		});
		const report = await connection.db.query.scanReports.findFirst({
			where: (fields, { eq }) => eq(fields.id, started.reportId),
		});
		expect(report).toMatchObject({
			status: "completed",
			attemptCount: 1,
			errorCode: null,
			retryable: null,
		});
		expect(report?.startedAt).toBeInstanceOf(Date);
		expect(report?.completedAt).toBeInstanceOf(Date);

		const artifact = await connection.db.query.scanArtifacts.findFirst({
			where: (fields, { eq }) => eq(fields.id, report?.artifactId ?? ""),
		});
		expect(artifact).toMatchObject({
			kind: "report",
			format: "markdown",
		});
		expect(artifact?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(artifact?.sizeBytes).toBeGreaterThan(0);
		const markdown = await fs.readFile(
			path.resolve(artifactRoot, artifact?.path ?? ""),
			"utf8",
		);
		expect(Buffer.byteLength(markdown, "utf8")).toBe(artifact?.sizeBytes);
	});

	it("persists the LLM route and prompt audit used to generate a report", async () => {
		const provider = {
			chatCompletion: vi.fn(async () => ({
				id: "report-summary-response",
				content: JSON.stringify({
					executiveSummary: "検出結果を確認し、優先順位に沿って対応します。",
					keyFindings: ["現時点で重大な検出事項はありません。"],
					riskNarrative: "利用可能な静的解析結果の範囲で評価しました。",
					recommendedNextActions: ["継続して定期的な検査を実施してください。"],
					confidenceNotes: ["評価範囲は保存済みの検査結果に限定されます。"],
				}),
			})),
		};
		const llmRouter = {
			resolve: vi.fn(async () => ({
				ok: true,
				task: "report_summary",
				target: {
					providerEndpointId: "test-provider",
					model: "test-model",
				},
				provider,
				providerName: "test:test-provider",
				model: "test-model",
			})),
		} as unknown as LlmRouter;
		const runner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			llmRouter,
		});

		const started = await runner.start({
			scanRunId,
			title: "Audited report",
			summaryMode: "deterministic_with_llm_summary",
			generatedByUserId: ownerUserId,
		});

		expect(await started.completion).toMatchObject({ status: "completed" });
		const report = await connection.db.query.scanReports.findFirst({
			where: (fields, { eq }) => eq(fields.id, started.reportId),
		});
		expect(report?.options).toMatchObject({
			providerRouting: {
				providerEndpointId: "test-provider",
				model: "test-model",
			},
			systemContext: { key: "scans.reportSummary" },
			promptMessages: [
				{ messageRole: "system" },
				{ messageRole: "user" },
			],
		});
		expect(
			(report?.options as Record<string, unknown>).promptSequenceHash,
		).toMatch(/^sha256:[a-f0-9]{64}$/);
		const artifact = await connection.db.query.scanArtifacts.findFirst({
			where: (fields, { eq }) => eq(fields.id, report?.artifactId ?? ""),
		});
		expect(artifact?.metadata).toMatchObject({
			reportId: started.reportId,
			systemContext: { key: "scans.reportSummary" },
			promptMessages: [
				{ messageRole: "system" },
				{ messageRole: "user" },
			],
		});
	});

	it("marks interrupted running reports failed and resumes queued reports", async () => {
		const reportRepository = new ScanReportRepository(connection.db);
		const interrupted = await reportRepository.createReport({
			scanRunId,
			format: "markdown",
			title: "Interrupted report",
			options: { summaryMode: "deterministic" },
			status: "running",
			generatedByUserId: ownerUserId,
		});
		const queued = await reportRepository.createReport({
			scanRunId,
			format: "markdown",
			title: "Queued report",
			options: { summaryMode: "deterministic" },
			status: "queued",
			generatedByUserId: ownerUserId,
		});
		const runner = new ScanReportRunner(connection.db, {
			reportRepository,
			artifactStorage: new ArtifactStorage(artifactRoot),
			concurrency: 1,
		});

		expect(await runner.recover()).toEqual({ queued: 1, interrupted: 1 });
		const recoveredQueued = await runner.enqueue(queued.id);
		expect(recoveredQueued.status).toBe("completed");
		expect(await reportRepository.findById(interrupted.id)).toMatchObject({
			status: "failed",
			errorCode: "report_interrupted",
			retryable: true,
		});
	});

	it("fails safely when generated Markdown exceeds the configured size", async () => {
		const runner = new ScanReportRunner(connection.db, {
			artifactStorage: new ArtifactStorage(artifactRoot),
			maxReportBytes: 1,
		});
		const started = await runner.start({
			scanRunId,
			title: "Oversized report",
			summaryMode: "deterministic",
			generatedByUserId: ownerUserId,
		});

		expect(await started.completion).toMatchObject({ status: "failed" });
		expect(
			await connection.db.query.scanReports.findFirst({
				where: (fields, { eq }) => eq(fields.id, started.reportId),
			}),
		).toMatchObject({
			status: "failed",
			errorCode: "report_too_large",
			retryable: false,
		});
		expect(await connection.db.select().from(scanArtifacts)).toHaveLength(0);
	});

	it("resolves the completion when claiming a queued report fails", async () => {
		const reportRepository = new ScanReportRepository(connection.db);
		const report = await reportRepository.createReport({
			scanRunId,
			format: "markdown",
			title: "Claim failure",
			options: { summaryMode: "deterministic" },
			status: "queued",
			generatedByUserId: ownerUserId,
		});
		const failingRepository = {
			claimQueuedReport: vi.fn(async () => {
				throw new Error("database unavailable");
			}),
			updateReportStatus:
				reportRepository.updateReportStatus.bind(reportRepository),
		};
		const runner = new ScanReportRunner(connection.db, {
			reportRepository: failingRepository as never,
		});

		await expect(runner.enqueue(report.id)).resolves.toEqual({
			reportId: report.id,
			status: "failed",
		});
		expect(await reportRepository.findById(report.id)).toMatchObject({
			status: "failed",
			errorCode: "report_generation_failed",
		});
	});

	it("fails a persisted queued report when enqueue is called after shutdown", async () => {
		const reportRepository = new ScanReportRepository(connection.db);
		const report = await reportRepository.createReport({
			scanRunId,
			format: "markdown",
			title: "Report after shutdown",
			options: { summaryMode: "deterministic" },
			status: "queued",
			generatedByUserId: ownerUserId,
		});
		const runner = new ScanReportRunner(connection.db, { reportRepository });
		await runner.shutdown(0);

		await expect(runner.enqueue(report.id)).resolves.toEqual({
			reportId: report.id,
			status: "failed",
		});
		expect(await reportRepository.findById(report.id)).toMatchObject({
			status: "failed",
			errorCode: "report_runner_shutting_down",
			retryable: true,
		});
	});
});
