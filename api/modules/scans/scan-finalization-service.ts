import { desc, eq } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	scanArtifacts,
	scanDiagnosticRuns,
	scanExecutionPlans,
	scanRuns,
} from "../../db/schema";
import { ArtifactStorage } from "./artifact-storage";
import {
	type FinalReportOptions,
	type FinalReportResult,
	generateFinalReport,
} from "./profile-runner";
import { ScanReportRepository } from "./report-repository";

/** Canonical reports are issued only after a terminal diagnostic snapshot. */
export async function finalizeScanAfterDiagnostic(params: {
	db: AppDatabase;
	scanRunId: string;
	options: Required<FinalReportOptions>;
	artifactStorage?: ArtifactStorage;
}): Promise<FinalReportResult> {
	const [scan] = await params.db
		.select({ status: scanRuns.status })
		.from(scanRuns)
		.where(eq(scanRuns.id, params.scanRunId));
	if (scan?.status !== "completed") {
		return skipped("scan_not_completed_for_finalization");
	}
	const [diagnostic] = await params.db
		.select({
			id: scanDiagnosticRuns.id,
			status: scanDiagnosticRuns.status,
			inputSnapshotHash: scanDiagnosticRuns.inputSnapshotHash,
			pipelineVersion: scanDiagnosticRuns.pipelineVersion,
			scanReviewId: scanDiagnosticRuns.scanReviewId,
		})
		.from(scanDiagnosticRuns)
		.where(eq(scanDiagnosticRuns.scanRunId, params.scanRunId))
		.orderBy(desc(scanDiagnosticRuns.completedAt))
		.limit(1);
	if (
		!diagnostic ||
		(diagnostic.status !== "completed" &&
			diagnostic.status !== "completed_with_limitations")
	) {
		return skipped("automated_diagnostic_required_before_final_report");
	}
	const [executionPlan] = await params.db
		.select({ planHash: scanExecutionPlans.planHash })
		.from(scanExecutionPlans)
		.where(eq(scanExecutionPlans.scanRunId, params.scanRunId));
	const reportRepo = new ScanReportRepository(params.db);
	const previousReports = await reportRepo.listReportsForScan(params.scanRunId);
	const latestPreliminary = previousReports.find(
		(candidate) => candidate.stage === "preliminary",
	);
	const reportMetadata = {
		stage: "canonical_final",
		diagnosticRunId: diagnostic.id,
		diagnosticSnapshotHash: diagnostic.inputSnapshotHash,
		diagnosticPipelineVersion: diagnostic.pipelineVersion,
		reviewId: diagnostic.scanReviewId,
		executionPlanHash: executionPlan?.planHash ?? null,
	};
	const report = await reportRepo.createOrFindCanonicalFinalReport({
		scanRunId: params.scanRunId,
		format: "markdown",
		title: params.options.title,
		options: {
			includeFalsePositives: params.options.includeFalsePositives,
			includeDeferred: params.options.includeDeferred,
			includeUndecided: params.options.includeUndecided,
			source: "scan-profile-final-report",
			...reportMetadata,
		},
		supersedesReportId: latestPreliminary?.id ?? null,
	});
	if (report.status === "completed") {
		const reportSnapshotHash = readOptionString(
			report.options,
			"diagnosticSnapshotHash",
		);
		if (reportSnapshotHash !== diagnostic.inputSnapshotHash) {
			return await refreshCanonicalFinal({
				db: params.db,
				scanRunId: params.scanRunId,
				reportId: report.id,
				artifactStorage: params.artifactStorage ?? new ArtifactStorage(),
				options: params.options,
				reportMetadata,
				reportRepo,
			});
		}
		if (!report.artifactId)
			return skipped("canonical_final_report_inconsistent");
		const [artifact] = await params.db
			.select({ path: scanArtifacts.path })
			.from(scanArtifacts)
			.where(eq(scanArtifacts.id, report.artifactId));
		if (!artifact) return skipped("canonical_final_report_artifact_missing");
		return {
			ok: true,
			reportId: report.id,
			artifactId: report.artifactId,
			artifactPath: artifact.path,
			status: "completed",
			error: null,
		};
	}
	if (report.status === "running") {
		return skipped("canonical_final_report_in_progress");
	}
	const claimed = await reportRepo.claimCanonicalFinalReport(report.id);
	if (!claimed) {
		const current = await reportRepo.findCanonicalFinalReport(params.scanRunId);
		if (current?.status === "running") {
			return skipped("canonical_final_report_in_progress");
		}
		return skipped("canonical_final_report_claim_lost");
	}
	return await generateClaimedCanonicalFinal({
		db: params.db,
		scanRunId: params.scanRunId,
		artifactStorage: params.artifactStorage ?? new ArtifactStorage(),
		options: params.options,
		reportId: claimed.id,
		reportMetadata,
	});
}

async function refreshCanonicalFinal(params: {
	db: AppDatabase;
	scanRunId: string;
	reportId: string;
	artifactStorage: ArtifactStorage;
	options: Required<FinalReportOptions>;
	reportMetadata: Record<string, unknown>;
	reportRepo: ScanReportRepository;
}): Promise<FinalReportResult> {
	const claimed = await params.reportRepo.claimCanonicalFinalReport(
		params.reportId,
	);
	if (!claimed) return skipped("canonical_final_report_in_progress");
	return await generateClaimedCanonicalFinal(params);
}

async function generateClaimedCanonicalFinal(params: {
	db: AppDatabase;
	scanRunId: string;
	reportId: string;
	artifactStorage: ArtifactStorage;
	options: Required<FinalReportOptions>;
	reportMetadata: Record<string, unknown>;
}): Promise<FinalReportResult> {
	return await generateFinalReport({
		db: params.db,
		scanRunId: params.scanRunId,
		artifactStorage: params.artifactStorage,
		options: params.options,
		reportId: params.reportId,
		reportMetadata: params.reportMetadata,
	});
}

function readOptionString(options: unknown, key: string): string | null {
	if (!options || typeof options !== "object" || Array.isArray(options)) {
		return null;
	}
	const value = (options as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

function skipped(error: string): FinalReportResult {
	return {
		ok: false,
		reportId: null,
		artifactId: null,
		artifactPath: null,
		status: "skipped",
		error,
	};
}
