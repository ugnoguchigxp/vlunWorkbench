import { eq } from "drizzle-orm";
import type { AppEnv } from "../app/env";
import type { AppDatabase } from "../db";
import { scanArtifacts } from "../db/schema";
import { LlmSettingsRepository } from "../modules/llm-settings/llm-settings.repository";
import { ScanReportRunner } from "../modules/reports/scan-report-runner";
import { ArtifactStorage } from "../modules/scans/artifact-storage";
import { ScanReportRepository } from "../modules/scans/report-repository";
import { ScanDiagnosticRunner } from "../modules/scans/scan-diagnostic-runner";
import { ScanReviewRunner } from "../modules/scans/scan-review-runner";
import { LlmRouter } from "../providers/llmRouter";

export async function runCliAutomatedDiagnostic(params: {
	db: AppDatabase;
	env: AppEnv;
	scanRunId: string;
}) {
	const llmRouter = new LlmRouter(
		new LlmSettingsRepository(params.db, params.env),
		params.env,
	);
	const reportRepository = new ScanReportRepository(params.db);
	const reportRunner = new ScanReportRunner(params.db, {
		reportRepository,
		artifactStorage: new ArtifactStorage(),
		llmRouter,
	});
	const diagnosticRunner = new ScanDiagnosticRunner(params.db, {
		reviewRunner: new ScanReviewRunner(params.db, { llmRouter }),
		reportRunner,
		reportRepository,
	});
	try {
		const diagnostic = await diagnosticRunner.run(params.scanRunId);
		const report = diagnostic.reportId
			? await reportRepository.findById(diagnostic.reportId)
			: null;
		const artifact = report?.artifactId
			? ((await params.db.query.scanArtifacts.findFirst({
					where: eq(scanArtifacts.id, report.artifactId),
				})) ?? null)
			: null;
		return {
			...diagnostic,
			reportArtifactPath: artifact?.path ?? null,
		};
	} finally {
		await diagnosticRunner.shutdown();
		await reportRunner.shutdown();
	}
}
