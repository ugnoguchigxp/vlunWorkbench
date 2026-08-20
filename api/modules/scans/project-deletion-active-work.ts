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
	threatModelRuns,
} from "../../db/schema";

const activeStatuses = ["queued", "running"] as const;
const activePrepareJobStatuses = ["requested", ...activeStatuses] as const;

export type ProjectActiveWork = {
	kind:
		| "scan_runs"
		| "static_intelligence_prepare_jobs"
		| "scan_reviews"
		| "scan_reports"
		| "scan_diagnostic_runs"
		| "dast_runs"
		| "dynamic_runs"
		| "reproduction_runs"
		| "active_assessment_runs"
		| "threat_model_runs"
		| "business_logic_runs";
	count: number;
};

const countRows = async <T>(query: Promise<T[]>): Promise<number> =>
	(await query).length;

/** Lists active work without exposing PIDs, commands, or other execution details. */
export async function listProjectActiveWork(
	db: AppDatabase,
	projectId: string,
): Promise<ProjectActiveWork[]> {
	const entries = await Promise.all([
		countRows(
			db
				.select({ id: scanRuns.id })
				.from(scanRuns)
				.where(
					and(
						eq(scanRuns.projectId, projectId),
						inArray(scanRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: staticIntelligencePrepareJobs.id })
				.from(staticIntelligencePrepareJobs)
				.where(
					and(
						eq(staticIntelligencePrepareJobs.projectId, projectId),
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
						eq(scanReviews.projectId, projectId),
						inArray(scanReviews.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: scanReports.id })
				.from(scanReports)
				.innerJoin(scanRuns, eq(scanReports.scanRunId, scanRuns.id))
				.where(
					and(
						eq(scanRuns.projectId, projectId),
						inArray(scanReports.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: scanDiagnosticRuns.id })
				.from(scanDiagnosticRuns)
				.innerJoin(scanRuns, eq(scanDiagnosticRuns.scanRunId, scanRuns.id))
				.where(
					and(
						eq(scanRuns.projectId, projectId),
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
						eq(dastRuns.projectId, projectId),
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
						eq(dynamicRuns.projectId, projectId),
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
						eq(reproductionRuns.projectId, projectId),
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
						eq(activeAssessmentRuns.projectId, projectId),
						inArray(activeAssessmentRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: threatModelRuns.id })
				.from(threatModelRuns)
				.where(
					and(
						eq(threatModelRuns.projectId, projectId),
						inArray(threatModelRuns.status, activeStatuses),
					),
				),
		),
		countRows(
			db
				.select({ id: businessLogicRuns.id })
				.from(businessLogicRuns)
				.where(
					and(
						eq(businessLogicRuns.projectId, projectId),
						inArray(businessLogicRuns.status, activeStatuses),
					),
				),
		),
	]);
	const kinds: ProjectActiveWork["kind"][] = [
		"scan_runs",
		"static_intelligence_prepare_jobs",
		"scan_reviews",
		"scan_reports",
		"scan_diagnostic_runs",
		"dast_runs",
		"dynamic_runs",
		"reproduction_runs",
		"active_assessment_runs",
		"threat_model_runs",
		"business_logic_runs",
	];
	return entries.reduce<ProjectActiveWork[]>((result, count, index) => {
		const kind = kinds[index];
		if (count > 0 && kind) result.push({ kind, count });
		return result;
	}, []);
}
