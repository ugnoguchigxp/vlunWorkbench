import type { DiagnosticReport, Finding } from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import type {
	EvidenceQualityLevel,
	EvidenceQualityView,
} from "./evidence-quality";
import { formatFindingTitle } from "./scan-display-copy";

export type RiskBand = "critical" | "high" | "medium" | "low" | "informational";

export type ExecutiveRiskSummary = {
	scanRunId: string;
	riskBand: RiskBand;
	score: number;
	headline: string;
	keyDrivers: Array<{
		id: string;
		label: string;
		severity?: string;
		findingId?: string;
		evidenceLevel?: EvidenceQualityLevel;
	}>;
	counts: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
		strongEvidence: number;
		weakOrMissingEvidence: number;
		reproduced: number;
		acceptedRisk: number;
		falsePositive: number;
		needsFix: number;
		undecided: number;
	};
	recommendedFocus: Array<{
		findingId: string;
		title: string;
		reason: string;
	}>;
};

type BuildExecutiveRiskSummaryInput = {
	scanRunId: string;
	findings: Finding[];
	evidenceByFindingId?: Map<string, EvidenceQualityView>;
	reproducedFindingIds?: Set<string>;
	coverageSummary?: CoverageSummary | null;
	diagnosticReports?: DiagnosticReport[];
};

const severityScore: Record<string, number> = {
	critical: 95,
	high: 80,
	medium: 55,
	low: 30,
	info: 10,
	unknown: 20,
};

const severityRank: Record<string, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

const bandForScore = (score: number): RiskBand => {
	if (score >= 90) return "critical";
	if (score >= 70) return "high";
	if (score >= 45) return "medium";
	if (score >= 15) return "low";
	return "informational";
};

const countSeverity = (findings: Finding[], severity: string): number =>
	findings.filter((finding) => finding.severity === severity).length;

const evidenceConfidenceAdjustment = (
	evidence: EvidenceQualityView | undefined,
): number => {
	if (!evidence) return -10;
	if (evidence.level === "strong") return 5;
	if (evidence.level === "moderate") return 0;
	if (evidence.level === "weak") return -8;
	return -15;
};

export function buildExecutiveRiskSummary(
	input: BuildExecutiveRiskSummaryInput,
): ExecutiveRiskSummary {
	const counts = {
		critical: countSeverity(input.findings, "critical"),
		high: countSeverity(input.findings, "high"),
		medium: countSeverity(input.findings, "medium"),
		low: countSeverity(input.findings, "low"),
		info: countSeverity(input.findings, "info"),
		strongEvidence: 0,
		weakOrMissingEvidence: 0,
		reproduced: input.reproducedFindingIds?.size ?? 0,
		acceptedRisk: 0,
		falsePositive: 0,
		needsFix: 0,
		undecided: 0,
	};

	for (const finding of input.findings) {
		const decision = finding.latestDecision?.decision;
		if (decision === "accepted") counts.acceptedRisk += 1;
		else if (decision === "false_positive") counts.falsePositive += 1;
		else if (decision === "needs_fix") counts.needsFix += 1;
		else if (!decision) counts.undecided += 1;
		const evidence = input.evidenceByFindingId?.get(finding.id);
		if (evidence?.level === "strong") counts.strongEvidence += 1;
		if (
			!evidence ||
			evidence.level === "weak" ||
			evidence.level === "missing"
		) {
			counts.weakOrMissingEvidence += 1;
		}
	}

	if (input.findings.length === 0) {
		const completedDiagnostic =
			input.coverageSummary?.latestDiagnosticReport ??
			input.diagnosticReports?.find(
				(report) => report.status === "completed",
			) ??
			null;
		const blockers = input.coverageSummary?.missingActions.length ?? 0;
		return {
			scanRunId: input.scanRunId,
			riskBand: blockers > 0 ? "low" : "informational",
			score: blockers > 0 ? 20 : 5,
			headline: completedDiagnostic
				? "finding はありません。診断カバレッジの文脈を確認済みです。"
				: "finding はありませんが、カバレッジの明示確認がまだ必要です。",
			keyDrivers: [
				{
					id: "zero-findings",
					label: completedDiagnostic
						? "finding 0 件の scan に診断文脈があります"
						: "finding 0 件の scan にカバレッジ説明が不足しています",
				},
			],
			counts,
			recommendedFocus:
				blockers > 0
					? [
							{
								findingId: "",
								title: "finding 0 件のカバレッジを確認",
								reason: "低リスクとして扱う前に診断を生成してください。",
							},
						]
					: [],
		};
	}

	const scored = input.findings
		.map((finding) => {
			const decision = finding.latestDecision?.decision;
			const evidence = input.evidenceByFindingId?.get(finding.id);
			const suppressed = decision === "false_positive";
			const accepted = decision === "accepted";
			let score = severityScore[finding.severity] ?? severityScore.unknown;
			score += evidenceConfidenceAdjustment(evidence);
			if (decision === "needs_fix" || !decision) score += 8;
			if (accepted) score -= 10;
			if (suppressed) score = 0;
			return { finding, evidence, score: Math.max(0, Math.min(100, score)) };
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return (
				severityRank[a.finding.severity] - severityRank[b.finding.severity]
			);
		});
	const top = scored[0];
	const score = top?.score ?? 0;
	const riskBand = bandForScore(score);

	return {
		scanRunId: input.scanRunId,
		riskBand,
		score,
		headline:
			riskBand === "critical"
				? "緊急リスクです。即時の実装修正に向けて次の LLM へ渡してください。"
				: riskBand === "high"
					? "高リスクの finding は、レポート公開前に実装修正へ変換してください。"
					: riskBand === "medium"
						? "中程度のリスクが残っています。証跡を強化し、実装ガイダンスを生成してください。"
						: "現在のリスクは低めですが、証跡とカバレッジの制約があります。",
		keyDrivers: scored.slice(0, 3).map(({ finding, evidence }) => ({
			id: `driver:${finding.id}`,
			label: formatFindingTitle(finding.title),
			severity: finding.severity,
			findingId: finding.id,
			evidenceLevel: evidence?.level,
		})),
		counts,
		recommendedFocus: scored
			.filter(
				({ finding }) => finding.latestDecision?.decision !== "false_positive",
			)
			.slice(0, 3)
			.map(({ finding, evidence }) => ({
				findingId: finding.id,
				title: formatFindingTitle(finding.title),
				reason:
					finding.latestDecision?.decision === "accepted"
						? "許容済みの露出として残っていますが、実装での低減も検討してください。"
						: evidence?.level === "weak" || evidence?.level === "missing"
							? "証跡の信頼度が弱いため、リスク文脈と検証作業として LLM に渡してください。"
							: "優先度の高い実装リスク項目です。",
			})),
	};
}
