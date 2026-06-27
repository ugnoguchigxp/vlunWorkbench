import type { Finding } from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";
import type { ScanComparisonView } from "./scan-comparison";

export type ReportQualityPreview = {
	scanRunId: string;
	sections: Array<{
		id: string;
		label: string;
		status: "ready" | "missing" | "partial";
		reason?: string;
	}>;
	readiness: "ready" | "partial" | "blocked";
	missingInputs: string[];
	recommendedReportTitle: string;
};

type BuildReportQualityPreviewInput = {
	scanRunId: string;
	findings: Finding[];
	evidenceByFindingId?: Map<string, EvidenceQualityView>;
	remediationByFindingId?: Map<string, RemediationPlanView>;
	comparison?: ScanComparisonView | null;
	coverageSummary?: CoverageSummary | null;
	hasScanImprovementRequest?: boolean;
};

const section = (
	id: string,
	label: string,
	status: "ready" | "missing" | "partial",
	reason?: string,
) => ({ id, label, status, reason });

export function buildReportQualityPreview(
	input: BuildReportQualityPreviewInput,
): ReportQualityPreview {
	const missingInputs: string[] = [];
	const undecided = input.findings.filter((finding) => !finding.latestDecision);
	const handoffComplete =
		Boolean(input.hasScanImprovementRequest) || undecided.length === 0;
	const weakEvidence = input.findings.filter((finding) => {
		const evidence = input.evidenceByFindingId?.get(finding.id);
		return (
			!evidence || evidence.level === "weak" || evidence.level === "missing"
		);
	});
	const remediationBlocked = input.findings.filter((finding) => {
		const plan = input.remediationByFindingId?.get(finding.id);
		return plan ? plan.blockingReasons.length > 0 : false;
	});
	const zeroFindingNeedsCoverage =
		input.findings.length === 0 &&
		!input.coverageSummary?.latestDiagnosticReport &&
		(input.coverageSummary?.missingActions.length ?? 1) > 0;

	if (input.findings.length > 0 && !handoffComplete) {
		missingInputs.push("implementation handoff");
	}
	if (weakEvidence.length > 0) missingInputs.push("evidence confidence");
	if (remediationBlocked.length > 0) missingInputs.push("remediation plan");
	if (zeroFindingNeedsCoverage)
		missingInputs.push("zero-finding coverage explanation");

	const hasFindings = input.findings.length > 0;
	const sections = [
		section("executive-summary", "Executive summary", "ready"),
		section(
			"risk-ranking",
			"Risk ranking",
			"ready",
			hasFindings
				? undefined
				: "No active findings to rank; coverage explanation is used instead.",
		),
		section(
			"evidence-quality",
			"Evidence quality summary",
			weakEvidence.length === 0 ? "ready" : "partial",
			weakEvidence.length > 0
				? `${weakEvidence.length} finding(s) have weak or missing evidence.`
				: undefined,
		),
		section(
			"implementation-handoff",
			"Implementation handoff",
			handoffComplete
				? "ready"
				: input.hasScanImprovementRequest
					? "partial"
					: "missing",
			undecided.length > 0
				? input.hasScanImprovementRequest
					? `${undecided.length} finding(s) are undecided, but a scan-level LLM handoff is available.`
					: "Generate a scan-level improvement request before reporting."
				: undefined,
		),
		section(
			"remediation-plan",
			"Remediation plan",
			remediationBlocked.length === 0 ? "ready" : "missing",
			remediationBlocked.length > 0
				? `${remediationBlocked.length} finding(s) are blocked.`
				: undefined,
		),
		section(
			"verification-status",
			"Verification status",
			weakEvidence.length === 0 ? "ready" : "partial",
		),
		section(
			"scan-comparison",
			"Scan comparison delta",
			input.comparison?.status === "available" ? "ready" : "partial",
			input.comparison?.status !== "available"
				? "Baseline comparison is not available."
				: undefined,
		),
		section(
			"zero-finding-coverage",
			"Zero-finding coverage explanation",
			hasFindings ? "ready" : zeroFindingNeedsCoverage ? "missing" : "ready",
			zeroFindingNeedsCoverage
				? "Coverage diagnostics are missing."
				: undefined,
		),
		section("appendix", "Appendix with evidence references", "ready"),
	];
	const hasMissing = sections.some((item) => item.status === "missing");
	const hasPartial = sections.some((item) => item.status === "partial");
	return {
		scanRunId: input.scanRunId,
		sections,
		readiness: hasMissing ? "blocked" : hasPartial ? "partial" : "ready",
		missingInputs,
		recommendedReportTitle: `Security Report - ${input.scanRunId.slice(0, 8)}`,
	};
}
