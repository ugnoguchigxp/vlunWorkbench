export type { ReportBuilderOptions } from "./report-builder-helpers";

import type { AppDatabase } from "../../../db";
import { renderReportCoverage } from "./report-builder-coverage";
import { finalizeMarkdownReport } from "./report-builder-finalize";
import { createFindingGroupRenderer } from "./report-builder-findings";
import type { ReportBuilderOptions } from "./report-builder-helpers";
import { renderReportOverview } from "./report-builder-overview";
import { buildReportQuery } from "./report-builder-query";

export async function buildMarkdownReport(
	db: AppDatabase,
	scanRunId: string,
	options: ReportBuilderOptions,
): Promise<string> {
	const query = await buildReportQuery(db, scanRunId, options);
	const overview = renderReportOverview(query);
	const scope = { ...query, ...overview, scanRunId };
	renderReportCoverage(scope);
	const findings = createFindingGroupRenderer(scope);
	return await finalizeMarkdownReport({ ...scope, ...findings, db, options });
}
