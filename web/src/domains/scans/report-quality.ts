import type { Finding } from "../../api";
import {
	getReportSectionDefinition,
	type ReportSectionId,
} from "../../../../shared/report-sections";
import type { CoverageSummary } from "./coverage-summary";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";
import {
	buildGenerationWarning,
	getReportReadinessCopy,
	getReportSubmissionLevel,
} from "./report-readiness-copy";
import type { ScanComparisonView } from "./scan-comparison";

export type ReportReadiness = "ready" | "partial" | "blocked";
export type ReportSubmissionLevel =
	| "submission_ready"
	| "internal_review"
	| "incomplete";

export type ReportQualityPreview = {
	scanRunId: string;
	sections: Array<{
		id: ReportSectionId;
		label: string;
		status: "ready" | "missing" | "partial";
		reason?: string;
	}>;
	readiness: ReportReadiness;
	submissionLevel: ReportSubmissionLevel;
	generationWarning: string | null;
	primaryActionLabel: string;
	secondaryStatusLabel: string;
	toolbarActionLabel: string;
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
	id: ReportSectionId,
	status: "ready" | "missing" | "partial",
	reason?: string,
) => ({ id, label: getReportSectionDefinition(id).label, status, reason });

export function buildReportQualityPreview(
	input: BuildReportQualityPreviewInput,
): ReportQualityPreview {
	const missingInputs: string[] = [];
	const findingsWithoutLegacyDecision = input.findings.filter(
		(finding) => !finding.latestDecision,
	);
	const hasImplementationHandoff =
		input.findings.length === 0 || Boolean(input.hasScanImprovementRequest);
	const weakEvidence = input.findings.filter((finding) => {
		const evidence = input.evidenceByFindingId?.get(finding.id);
		return (
			!evidence || evidence.level === "weak" || evidence.level === "missing"
		);
	});
	const remediationBlocked = input.findings.filter((finding) => {
		const plan = input.remediationByFindingId?.get(finding.id);
		if (!plan) return false;
		const blockingReasons = input.hasScanImprovementRequest
			? plan.blockingReasons.filter((reason) => reason !== "decision_required")
			: plan.blockingReasons;
		return blockingReasons.length > 0;
	});
	const zeroFindingNeedsCoverage =
		input.findings.length === 0 &&
		!input.coverageSummary?.latestDiagnosticReport &&
		(input.coverageSummary?.missingActions.length ?? 1) > 0;

	if (input.findings.length > 0 && !hasImplementationHandoff) {
		missingInputs.push("LLM 実装引き継ぎが不足");
	}
	if (weakEvidence.length > 0) missingInputs.push("証跡が弱いまたは不足");
	if (remediationBlocked.length > 0) missingInputs.push("修正計画が不足");
	if (zeroFindingNeedsCoverage)
		missingInputs.push("finding 0 件のカバレッジ説明が不足");

	const hasFindings = input.findings.length > 0;
	const sections = [
		section("executive-summary", "ready"),
		section(
			"risk-ranking",
			"ready",
			hasFindings
				? undefined
				: "順位付け対象の有効な finding がないため、代わりにカバレッジ説明を使います。",
		),
		section(
			"evidence-quality",
			weakEvidence.length === 0 ? "ready" : "partial",
			weakEvidence.length > 0
				? `${weakEvidence.length} 件の finding は証跡が弱いか不足しています。`
				: undefined,
		),
		section(
			"finding-decisions",
			hasImplementationHandoff ? "ready" : "missing",
			!hasFindings
				? "実装引き継ぎが必要な finding はありません。"
				: findingsWithoutLegacyDecision.length > 0
					? input.hasScanImprovementRequest
						? `${findingsWithoutLegacyDecision.length} 件の finding に互換 Decision はありませんが、scan 単位の LLM 実装引き継ぎがあります。`
						: "レポート生成前に scan 単位の LLM 実装引き継ぎを生成してください。"
					: undefined,
		),
		section(
			"remediation-plan",
			remediationBlocked.length === 0 ? "ready" : "missing",
			remediationBlocked.length > 0
				? `${remediationBlocked.length} 件の finding がブロック中です。`
				: undefined,
		),
		section(
			"verification-status",
			weakEvidence.length === 0 ? "ready" : "partial",
			weakEvidence.length > 0
				? "証跡が弱いか不足しているため、提出用の検証品質ではありません。"
				: undefined,
		),
		section(
			"scan-comparison",
			input.comparison?.status === "available" ? "ready" : "partial",
			input.comparison?.status !== "available"
				? "baseline 比較を利用できません。"
				: undefined,
		),
		section(
			"zero-finding-coverage",
			hasFindings ? "ready" : zeroFindingNeedsCoverage ? "missing" : "ready",
			zeroFindingNeedsCoverage ? "カバレッジ診断が不足しています。" : undefined,
		),
		section("appendix", "ready"),
	];
	const hasMissing = sections.some((item) => item.status === "missing");
	const hasPartial = sections.some((item) => item.status === "partial");
	const readiness: ReportReadiness = hasMissing
		? "blocked"
		: hasPartial
			? "partial"
			: "ready";
	const submissionLevel = getReportSubmissionLevel(readiness);
	const copy = getReportReadinessCopy(submissionLevel);
	const generationWarning = buildGenerationWarning({
		readiness,
		missingInputs,
		partialReasons: sections
			.filter((item) => item.status === "partial" && item.reason)
			.map((item) => item.reason ?? ""),
	});
	return {
		scanRunId: input.scanRunId,
		sections,
		readiness,
		submissionLevel,
		generationWarning,
		primaryActionLabel: copy.primaryActionLabel,
		secondaryStatusLabel: copy.secondaryStatusLabel,
		toolbarActionLabel: copy.toolbarActionLabel,
		missingInputs,
		recommendedReportTitle: `セキュリティレポート - ${input.scanRunId.slice(0, 8)}`,
	};
}
