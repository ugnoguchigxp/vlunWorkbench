import fs from "node:fs/promises";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { scanRuns } from "../db/schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { buildMarkdownReport } from "../modules/scans/report-builder";
import { ScanReportRepository } from "../modules/scans/report-repository";
import { buildMarkdownReportWithLlmSummary } from "../modules/scans/report-summary-runner";
import { ArtifactRepository } from "../modules/scans/repositories";
import { LlmRouter } from "../providers/llmRouter";

function writeResult(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload));
}

async function main() {
	let argsValues: Record<string, string | undefined>;
	try {
		const parsed = parseArgs({
			args: process.argv.slice(2),
			options: {
				"scan-run-id": { type: "string" },
				format: { type: "string" },
				"include-false-positives": { type: "string" },
				"include-deferred": { type: "string" },
				"include-undecided": { type: "string" },
				title: { type: "string" },
				output: { type: "string" },
				"summary-mode": { type: "string" },
			},
			strict: true,
		});
		argsValues = parsed.values as Record<string, string | undefined>;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		writeResult({
			ok: false,
			status: "failed",
			message: `Failed to parse arguments: ${msg}`,
		});
		process.exit(1);
	}

	const scanRunId = argsValues["scan-run-id"];
	if (!scanRunId) {
		writeResult({
			ok: false,
			status: "failed",
			message: "Missing required argument: --scan-run-id is required.",
		});
		process.exit(1);
	}

	const format = argsValues.format || "markdown";
	if (format !== "markdown") {
		writeResult({
			ok: false,
			status: "failed",
			message: `Unsupported format: ${format}. Only 'markdown' is supported.`,
		});
		process.exit(1);
	}

	const includeFalsePositives =
		argsValues["include-false-positives"] === undefined
			? true
			: argsValues["include-false-positives"] === "true";
	const includeDeferred =
		argsValues["include-deferred"] === undefined
			? true
			: argsValues["include-deferred"] === "true";
	const includeUndecided =
		argsValues["include-undecided"] === undefined
			? true
			: argsValues["include-undecided"] === "true";

	const title = argsValues.title || "セキュリティレポート";
	const outputPath = argsValues.output;
	const summaryMode = argsValues["summary-mode"] || "deterministic";
	if (
		summaryMode !== "deterministic" &&
		summaryMode !== "deterministic_with_llm_summary"
	) {
		writeResult({
			ok: false,
			status: "failed",
			message: `Unsupported summary mode: ${summaryMode}`,
		});
		process.exit(1);
	}

	const env = readAppEnv();
	const dbConnection = createDbConnection(env.databaseUrl);
	const db = dbConnection.db;

	let reportId: string | undefined;

	try {
		// 1. Verify scan run exists
		const [scanRun] = await db
			.select()
			.from(scanRuns)
			.where(eq(scanRuns.id, scanRunId));
		if (!scanRun) {
			writeResult({
				ok: false,
				status: "failed",
				message: `Scan run not found: ${scanRunId}`,
			});
			process.exit(1);
		}

		// 2. Initialize repositories & storage
		const reportRepo = new ScanReportRepository(db);
		const artifactRepo = new ArtifactRepository(db);
		const storage = new ArtifactStorage();

		// 3. Create scan report in running state
		const report = await reportRepo.createReport({
			scanRunId,
			format,
			title,
			options: {
				includeFalsePositives,
				includeDeferred,
				includeUndecided,
				summaryMode,
			},
			status: "running",
		});
		reportId = report.id;

		// 4. Build report
		const builderOptions = {
			includeFalsePositives,
			includeDeferred,
			includeUndecided,
			title,
		};
		const buildResult =
			summaryMode === "deterministic_with_llm_summary"
				? await buildMarkdownReportWithLlmSummary(db, scanRunId, {
						...builderOptions,
						llmRouter: new LlmRouter(
							new LlmSettingsRepository(dbConnection.db, env),
							env,
						),
					})
				: {
						markdown: await buildMarkdownReport(db, scanRunId, builderOptions),
						providerRouting: undefined,
						systemContext: undefined,
						promptMessages: undefined,
						promptSequenceHash: undefined,
					};
		const markdown = buildResult.markdown;

		// 5. Save to artifact storage
		const filename = `report-${report.id}.md`;
		const saveResult = await storage.saveTextArtifact(
			scanRunId,
			"reports",
			markdown,
			filename,
		);

		// 6. Create scan artifact metadata
		const artifact = await artifactRepo.createArtifact({
			scanRunId,
			toolRunId: null,
			kind: "report",
			format: "markdown",
			path: saveResult.path,
			sha256: saveResult.sha256,
			sizeBytes: saveResult.sizeBytes,
			metadata: {
				reportId: report.id,
				summaryMode,
				...(buildResult.providerRouting
					? { providerRouting: buildResult.providerRouting }
					: {}),
				...(buildResult.systemContext
					? { systemContext: buildResult.systemContext }
					: {}),
				...(buildResult.promptMessages
					? {
							promptMessages: buildResult.promptMessages,
							promptSequenceHash: buildResult.promptSequenceHash,
						}
					: {}),
			},
		});

		// 7. If output path specified, write the exact stored Markdown content.
		if (outputPath) {
			await fs.writeFile(outputPath, markdown, "utf8");
		}

		// 8. Complete report status
		await reportRepo.updateReportStatus(report.id, "completed", {
			artifactId: artifact.id,
			summary: markdown.slice(0, 500),
			options: {
				includeFalsePositives,
				includeDeferred,
				includeUndecided,
				summaryMode,
				...(buildResult.providerRouting
					? { providerRouting: buildResult.providerRouting }
					: {}),
				...(buildResult.systemContext
					? { systemContext: buildResult.systemContext }
					: {}),
				...(buildResult.promptMessages
					? {
							promptMessages: buildResult.promptMessages,
							promptSequenceHash: buildResult.promptSequenceHash,
						}
					: {}),
			},
		});

		writeResult({
			ok: true,
			scanRunId,
			reportId: report.id,
			artifactId: artifact.id,
			status: "completed",
			sha256: saveResult.sha256,
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		if (reportId) {
			try {
				const reportRepo = new ScanReportRepository(db);
				await reportRepo.updateReportStatus(reportId, "failed", {
					errorMessage: errMsg,
				});
			} catch (_) {
				// ignore nested db error
			}
		}

		writeResult({
			ok: false,
			scanRunId,
			reportId,
			status: "failed",
			message: `Failed to generate or save report: ${errMsg}`,
		});
		process.exit(1);
	} finally {
		dbConnection.sqlite.close();
	}
}

await main();
