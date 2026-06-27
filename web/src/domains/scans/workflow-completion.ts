import type { DiagnosticReport, Finding, ScanReport, ScanRun } from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";

export type WorkflowCompletion = {
	scanRunId: string;
	stage:
		| "scan_running"
		| "needs_review"
		| "needs_handoff"
		| "needs_verification"
		| "needs_remediation_plan"
		| "report_ready"
		| "report_generated";
	percent: number;
	checklist: Array<{
		id: string;
		label: string;
		status: "complete" | "incomplete" | "blocked" | "not_applicable";
		count?: string;
		blockingReason?: string;
	}>;
	nextBestAction: {
		label: string;
		action:
			| "review_findings"
			| "create_improvement_request"
			| "run_verification"
			| "create_remediation_plan"
			| "generate_report"
			| "inspect_coverage";
		targetId?: string;
	} | null;
};

type BuildWorkflowCompletionInput = {
	scanRun: ScanRun | null;
	findings: Finding[];
	evidenceByFindingId?: Map<string, EvidenceQualityView>;
	remediationByFindingId?: Map<string, RemediationPlanView>;
	reports?: ScanReport[];
	diagnosticReports?: DiagnosticReport[];
	coverageSummary?: CoverageSummary | null;
	hasScanImprovementRequest?: boolean;
};

const completeReport = (
	reports: ScanReport[] | undefined,
): ScanReport | undefined =>
	reports?.find((report) => report.status === "completed");

const incomplete = (
	id: string,
	label: string,
	count?: string,
	blockingReason?: string,
) => ({ id, label, status: "incomplete" as const, count, blockingReason });

const complete = (id: string, label: string, count?: string) => ({
	id,
	label,
	status: "complete" as const,
	count,
});

export function buildWorkflowCompletion(
	input: BuildWorkflowCompletionInput,
): WorkflowCompletion {
	const scanRunId = input.scanRun?.id ?? "";
	const generatedReport = completeReport(input.reports);
	if (
		!input.scanRun ||
		input.scanRun.status === "queued" ||
		input.scanRun.status === "running"
	) {
		return {
			scanRunId,
			stage: "scan_running",
			percent: 10,
			checklist: [incomplete("scan", "Scan completed")],
			nextBestAction: null,
		};
	}

	if (input.findings.length === 0) {
		const hasDiagnostics =
			Boolean(input.coverageSummary?.latestDiagnosticReport) ||
			Boolean(
				input.diagnosticReports?.some(
					(report) => report.status === "completed",
				),
			);
		const checklist = [
			complete("scan", "Scan completed"),
			hasDiagnostics
				? complete("coverage", "Coverage explanation", "ready")
				: incomplete("coverage", "Coverage explanation", "missing"),
			generatedReport
				? complete("report", "Report generated")
				: incomplete("report", "Report generated"),
		];
		return {
			scanRunId,
			stage: generatedReport
				? "report_generated"
				: hasDiagnostics
					? "report_ready"
					: "needs_verification",
			percent: generatedReport ? 100 : hasDiagnostics ? 85 : 45,
			checklist,
			nextBestAction: generatedReport
				? null
				: hasDiagnostics
					? {
							label: "Generate report",
							action: "generate_report",
							targetId: scanRunId,
						}
					: {
							label: "Inspect coverage",
							action: "inspect_coverage",
							targetId: scanRunId,
						},
		};
	}

	const reviewed = input.findings.filter(
		(finding) => finding.latestReview?.status === "completed",
	);
	const decided = input.findings.filter((finding) => finding.latestDecision);
	const handoffComplete =
		decided.length === input.findings.length ||
		Boolean(input.hasScanImprovementRequest);
	const weakEvidence = input.findings.filter((finding) => {
		const evidence = input.evidenceByFindingId?.get(finding.id);
		return (
			!evidence || evidence.level === "weak" || evidence.level === "missing"
		);
	});
	const remediationBlocked = input.findings.filter((finding) => {
		const remediation = input.remediationByFindingId?.get(finding.id);
		return remediation ? remediation.blockingReasons.length > 0 : false;
	});

	const checklist: WorkflowCompletion["checklist"] = [
		complete("scan", "Scan completed"),
		reviewed.length === input.findings.length
			? complete(
					"reviews",
					"Finding reviews",
					`${reviewed.length}/${input.findings.length}`,
				)
			: incomplete(
					"reviews",
					"Finding reviews",
					`${reviewed.length}/${input.findings.length}`,
				),
		handoffComplete
			? complete(
					"handoff",
					"Implementation handoff",
					input.hasScanImprovementRequest ? "ready" : "legacy decisions",
				)
			: incomplete("handoff", "Implementation handoff", "missing"),
		weakEvidence.length === 0
			? complete("verification", "Evidence confidence")
			: incomplete(
					"verification",
					"Evidence confidence",
					`${weakEvidence.length} weak/missing`,
				),
		remediationBlocked.length === 0
			? complete("remediation", "Remediation plan")
			: {
					id: "remediation",
					label: "Remediation plan",
					status: "blocked",
					count: `${remediationBlocked.length} blocked`,
					blockingReason: remediationBlocked[0]?.id,
				},
		generatedReport
			? complete("report", "Report generated")
			: incomplete("report", "Report generated"),
	];

	const completedCount = checklist.filter(
		(item) => item.status === "complete",
	).length;
	const percent = Math.round((completedCount / checklist.length) * 100);
	const firstUnreviewed = input.findings.find(
		(finding) => finding.latestReview?.status !== "completed",
	);
	const firstWeakEvidence = weakEvidence[0];
	const firstRemediationBlocked = remediationBlocked[0];

	if (generatedReport) {
		return {
			scanRunId,
			stage: "report_generated",
			percent: 100,
			checklist,
			nextBestAction: null,
		};
	}
	if (firstUnreviewed) {
		return {
			scanRunId,
			stage: "needs_review",
			percent,
			checklist,
			nextBestAction: {
				label: "Review findings",
				action: "review_findings",
				targetId: firstUnreviewed.id,
			},
		};
	}
	if (!handoffComplete) {
		return {
			scanRunId,
			stage: "needs_handoff",
			percent,
			checklist,
			nextBestAction: {
				label: "Generate improvement request",
				action: "create_improvement_request",
				targetId: scanRunId,
			},
		};
	}
	if (firstWeakEvidence) {
		return {
			scanRunId,
			stage: "needs_verification",
			percent,
			checklist,
			nextBestAction: {
				label: "Run verification",
				action: "run_verification",
				targetId: firstWeakEvidence.id,
			},
		};
	}
	if (firstRemediationBlocked) {
		return {
			scanRunId,
			stage: "needs_remediation_plan",
			percent,
			checklist,
			nextBestAction: {
				label: "Complete remediation plan",
				action: "create_remediation_plan",
				targetId: firstRemediationBlocked.id,
			},
		};
	}
	return {
		scanRunId,
		stage: "report_ready",
		percent: Math.max(percent, 90),
		checklist,
		nextBestAction: {
			label: "Generate report",
			action: "generate_report",
			targetId: scanRunId,
		},
	};
}
