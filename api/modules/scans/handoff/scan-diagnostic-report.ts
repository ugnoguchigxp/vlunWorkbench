import type { ScanReportRunner } from "../../reports/scan-report-runner";
import type { ScanReportRepository } from "../reporting/report-repository";

type DiagnosticReportParams = {
	diagnosticRunId: string;
	scanRunId: string;
	generatedByUserId: string | null;
	inputSnapshotHash: string;
	scannerProvenanceHash: string;
	reviewProvenance?: {
		scanReviewId: string;
		provider: string;
		model: string;
		promptSequenceHash: string | null;
		responseContentSha256: string | null;
	};
};

export async function produceDiagnosticReport(input: {
	params: DiagnosticReportParams;
	limitations: string[];
	pipelineVersion: string;
	reportRepository: ScanReportRepository;
	reportRunner: Pick<ScanReportRunner, "start">;
	reuseCompletedReport: boolean;
}) {
	const reports = await input.reportRepository.listReportsForScan(
		input.params.scanRunId,
	);
	if (input.reuseCompletedReport) {
		const completed = reports.find(
			(report) => report.status === "completed" && report.artifactId !== null,
		);
		if (completed) {
			return { reportId: completed.id, status: "completed" as const };
		}
	}

	const revision =
		reports.filter(
			(report) =>
				(report.options as Record<string, unknown>).source ===
				"automated-diagnostic",
		).length + 1;
	const started = await input.reportRunner.start({
		scanRunId: input.params.scanRunId,
		title: "自動セキュリティ診断レポート",
		summaryMode: "deterministic",
		generatedByUserId: input.params.generatedByUserId,
		options: {
			source: "automated-diagnostic",
			diagnosticRunId: input.params.diagnosticRunId,
			inputSnapshotHash: input.params.inputSnapshotHash,
			scannerProvenanceHash: input.params.scannerProvenanceHash,
			pipelineVersion: input.pipelineVersion,
			...(input.params.reviewProvenance ?? {}),
			outputRevision: revision,
			readiness:
				input.limitations.length > 0 ? "ready_with_limitations" : "ready",
			limitationCodes: input.limitations,
		},
	});
	return await started.completion;
}
