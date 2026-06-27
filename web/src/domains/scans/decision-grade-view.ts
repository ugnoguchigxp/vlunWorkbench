import type {
	DiagnosticReport,
	Finding,
	ScanReport,
	ScanReview,
	ScanRun,
} from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";
import {
	buildReportQualityPreview,
	type ReportQualityPreview,
} from "./report-quality";
import {
	buildExecutiveRiskSummary,
	type ExecutiveRiskSummary,
} from "./risk-summary";
import {
	buildScanComparison,
	type ScanComparisonView,
} from "./scan-comparison";
import { hasScanImprovementRequest } from "./scan-improvement-request";
import {
	buildWorkflowCompletion,
	type WorkflowCompletion,
} from "./workflow-completion";

export type BuildDecisionGradeViewInput = {
	selectedScanRunId: string;
	selectedScanRun: ScanRun | null;
	findings: Finding[];
	scanReviews: ScanReview[];
	evidenceQualityByFindingId: Map<string, EvidenceQualityView>;
	remediationPlanByFindingId: Map<string, RemediationPlanView>;
	reports: ScanReport[];
	diagnosticReports: DiagnosticReport[];
	selectedCoverageSummary: CoverageSummary;
	baselineScanRunId: string | null;
	baselineFindings: Finding[] | null;
};

export type DecisionGradeView = {
	executiveRiskSummary: ExecutiveRiskSummary;
	workflowCompletion: WorkflowCompletion;
	scanComparison: ScanComparisonView;
	reportQualityPreview: ReportQualityPreview;
	hasScanImprovementRequest: boolean;
};

export function buildDecisionGradeView(
	input: BuildDecisionGradeViewInput,
): DecisionGradeView {
	const scanComparison = buildScanComparison({
		currentScanRunId: input.selectedScanRunId,
		baselineScanRunId: input.baselineScanRunId,
		currentFindings: input.findings,
		baselineFindings: input.baselineFindings,
	});
	const hasImprovementRequest = input.scanReviews.some(
		hasScanImprovementRequest,
	);

	return {
		executiveRiskSummary: buildExecutiveRiskSummary({
			scanRunId: input.selectedScanRunId,
			findings: input.findings,
			evidenceByFindingId: input.evidenceQualityByFindingId,
			coverageSummary: input.selectedCoverageSummary,
			diagnosticReports: input.diagnosticReports,
		}),
		workflowCompletion: buildWorkflowCompletion({
			scanRun: input.selectedScanRun,
			findings: input.findings,
			evidenceByFindingId: input.evidenceQualityByFindingId,
			remediationByFindingId: input.remediationPlanByFindingId,
			reports: input.reports,
			diagnosticReports: input.diagnosticReports,
			coverageSummary: input.selectedCoverageSummary,
			hasScanImprovementRequest: hasImprovementRequest,
		}),
		scanComparison,
		reportQualityPreview: buildReportQualityPreview({
			scanRunId: input.selectedScanRunId,
			findings: input.findings,
			evidenceByFindingId: input.evidenceQualityByFindingId,
			remediationByFindingId: input.remediationPlanByFindingId,
			comparison: scanComparison,
			coverageSummary: input.selectedCoverageSummary,
			hasScanImprovementRequest: hasImprovementRequest,
		}),
		hasScanImprovementRequest: hasImprovementRequest,
	};
}
