import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "../../db";
import {
	activeAssessmentRuns,
	businessLogicRuns,
	dastRuns,
	dynamicRuns,
	reproductionRuns,
	scanDiagnosticRuns,
	scanReports,
	scanReviews,
	scanRuns,
	staticIntelligencePrepareJobs,
	toolRuns,
} from "../../db/schema";

const activeStatuses = ["queued", "running"] as const;
const activePrepareJobStatuses = ["requested", ...activeStatuses] as const;

export type ScanActiveWork = {
	kind:
		| "scan_runs"
		| "tool_runs"
		| "static_intelligence_prepare_jobs"
		| "scan_reviews"
		| "scan_reports"
		| "scan_diagnostic_runs"
		| "dast_runs"
		| "dynamic_runs"
		| "reproduction_runs"
		| "active_assessment_runs"
		| "business_logic_runs";
	count: number;
};

const countRows = async <T>(query: Promise<T[]>): Promise<number> =>
	(await query).length;

/** Lists work that still references one scan and must finish before deletion. */
export async function listScanActiveWork(
	db: AppDatabase,
	scanRunId: string,
): Promise<ScanActiveWork[]> {
	const entries = await Promise.all([
		countRows(
			db
				.select({ id: scanRuns.id })
				.from(scanRuns)
				.where(
					and(
						eq(scanRuns.id, scanRunId),
						inArray(scanRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: toolRuns.id })
				.from(toolRuns)
				.where(
					and(
						eq(toolRuns.scanRunId, scanRunId),
						inArray(toolRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: staticIntelligencePrepareJobs.id })
				.from(staticIntelligencePrepareJobs)
				.where(
					and(
						eq(staticIntelligencePrepareJobs.scanRunId, scanRunId),
						inArray(
							staticIntelligencePrepareJobs.status,
							activePrepareJobStatuses,
						),
					),
				),
		),
		countRows(
			db
				.select({ id: scanReviews.id })
				.from(scanReviews)
				.where(
					and(
						eq(scanReviews.scanRunId, scanRunId),
						inArray(scanReviews.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: scanReports.id })
				.from(scanReports)
				.where(
					and(
						eq(scanReports.scanRunId, scanRunId),
						inArray(scanReports.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: scanDiagnosticRuns.id })
				.from(scanDiagnosticRuns)
				.where(
					and(
						eq(scanDiagnosticRuns.scanRunId, scanRunId),
						inArray(scanDiagnosticRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: dastRuns.id })
				.from(dastRuns)
				.where(
					and(
						eq(dastRuns.scanRunId, scanRunId),
						inArray(dastRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: dynamicRuns.id })
				.from(dynamicRuns)
				.where(
					and(
						eq(dynamicRuns.scanRunId, scanRunId),
						inArray(dynamicRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: reproductionRuns.id })
				.from(reproductionRuns)
				.where(
					and(
						eq(reproductionRuns.scanRunId, scanRunId),
						inArray(reproductionRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: activeAssessmentRuns.id })
				.from(activeAssessmentRuns)
				.where(
					and(
						eq(activeAssessmentRuns.scanRunId, scanRunId),
						inArray(activeAssessmentRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: businessLogicRuns.id })
				.from(businessLogicRuns)
				.where(
					and(
						eq(businessLogicRuns.scanRunId, scanRunId),
						inArray(businessLogicRuns.status, activeStatuses),
					),
				),
		),
	]);
	const kinds: ScanActiveWork["kind"][] = [
		"scan_runs",
		"tool_runs",
		"static_intelligence_prepare_jobs",
		"scan_reviews",
		"scan_reports",
		"scan_diagnostic_runs",
		"dast_runs",
		"dynamic_runs",
		"reproduction_runs",
		"active_assessment_runs",
		"business_logic_runs",
	];
	return entries.reduce<ScanActiveWork[]>((result, count, index) => {
		const kind = kinds[index];
		if (count > 0 && kind) result.push({ kind, count });
		return result;
	}, []);
}
