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
		weight: number;
		explanation: string;
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
	weight: number,
	explanation: string,
	count?: string,
	blockingReason?: string,
) => ({
	id,
	label,
	status: "incomplete" as const,
	weight,
	explanation,
	count,
	blockingReason,
});

const complete = (
	id: string,
	label: string,
	weight: number,
	explanation: string,
	count?: string,
) => ({
	id,
	label,
	status: "complete" as const,
	weight,
	explanation,
	count,
});

const blocked = (
	id: string,
	label: string,
	weight: number,
	explanation: string,
	count?: string,
	blockingReason?: string,
) => ({
	id,
	label,
	status: "blocked" as const,
	weight,
	explanation,
	count,
	blockingReason,
});

const weightedPercent = (
	checklist: WorkflowCompletion["checklist"],
): number => {
	const applicable = checklist.filter(
		(item) => item.status !== "not_applicable",
	);
	const total = applicable.reduce((sum, item) => sum + item.weight, 0);
	if (total === 0) return 0;
	const completed = applicable
		.filter((item) => item.status === "complete")
		.reduce((sum, item) => sum + item.weight, 0);
	return Math.round((completed / total) * 100);
};

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
			checklist: [
				incomplete(
					"scan",
					"スキャン完了",
					10,
					"自動診断シグナルを作成するには、先にスキャン完了が必要です。",
				),
			],
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
			complete(
				"scan",
				"スキャン完了",
				10,
				"スキャン runner が完了し、結果を保存しました。",
			),
			hasDiagnostics
				? complete(
						"coverage",
						"カバレッジ説明",
						35,
						"finding 0 件のリスク確認に使える自動カバレッジ診断があります。",
						"準備完了",
					)
				: incomplete(
						"coverage",
						"カバレッジ説明",
						35,
						"finding 0 件の scan は、LLM へ渡す前に自動カバレッジ診断が必要です。",
						"不足",
					),
			generatedReport
				? complete(
						"report",
						"レポート生成",
						15,
						"保存済みレポートに自動診断の出力が反映されています。",
					)
				: incomplete(
						"report",
						"レポート生成",
						15,
						"カバレッジ診断が利用可能になった後でレポートを生成してください。",
					),
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
							label: "レポートを生成",
							action: "generate_report",
							targetId: scanRunId,
						}
					: {
							label: "カバレッジを確認",
							action: "inspect_coverage",
							targetId: scanRunId,
						},
		};
	}

	const reviewed = input.findings.filter(
		(finding) => finding.latestReview?.status === "completed",
	);
	const handoffComplete = Boolean(input.hasScanImprovementRequest);
	const weakEvidence = input.findings.filter((finding) => {
		const evidence = input.evidenceByFindingId?.get(finding.id);
		return (
			!evidence || evidence.level === "weak" || evidence.level === "missing"
		);
	});
	const remediationBlocked = input.findings.filter((finding) => {
		const remediation = input.remediationByFindingId?.get(finding.id);
		if (!remediation) return false;
		const blockingReasons = handoffComplete
			? remediation.blockingReasons.filter(
					(reason) => reason !== "decision_required",
				)
			: remediation.blockingReasons;
		return blockingReasons.length > 0;
	});

	const checklist: WorkflowCompletion["checklist"] = [
		complete(
			"scan",
			"スキャン完了",
			10,
			"スキャン runner が完了し、正規化済み finding を保存しました。",
		),
		reviewed.length === input.findings.length
			? complete(
					"reviews",
					"LLM finding レビュー出力",
					20,
					"すべての finding に完了済みの LLM レビュー出力があります。",
					`${reviewed.length}/${input.findings.length}`,
				)
			: incomplete(
					"reviews",
					"LLM finding レビュー出力",
					20,
					`${input.findings.length - reviewed.length} 件の finding は自動 LLM レビュー出力がまだ必要です。`,
					`${reviewed.length}/${input.findings.length}`,
				),
		handoffComplete
			? complete(
					"handoff",
					"LLM 修正依頼",
					20,
					"次の LLM または実装担当へ渡せる scan 単位の改善依頼があります。",
					"準備完了",
				)
			: incomplete(
					"handoff",
					"LLM 修正依頼",
					20,
					"次の LLM にコード上のリスク低減方法を伝える scan 単位の実装 handoff を生成してください。",
					"不足",
				),
		weakEvidence.length === 0
			? complete(
					"verification",
					"証跡の信頼度",
					20,
					"自動 handoff に十分な証跡品質があります。",
				)
			: incomplete(
					"verification",
					"証跡の信頼度",
					20,
					`${weakEvidence.length} 件の finding は証跡シグナルが弱いか不足しています。`,
					`${weakEvidence.length} 件 弱い/不足`,
				),
		remediationBlocked.length === 0
			? complete(
					"remediation",
					"修正または handoff の準備",
					15,
					"修正ガイダンスまたは scan 単位の handoff で後続作業を進められます。",
				)
			: blocked(
					"remediation",
					"修正または handoff の準備",
					15,
					`${remediationBlocked.length} 件の finding は修正メタデータがまだブロックされています。`,
					`${remediationBlocked.length} 件 ブロック中`,
					remediationBlocked[0]?.id,
				),
		generatedReport
			? complete(
					"report",
					"レポート生成",
					15,
					"保存済みレポートに自動診断の出力が反映されています。",
				)
			: incomplete(
					"report",
					"レポート生成",
					15,
					"LLM handoff と証跡シグナルが準備できた後でレポートを生成してください。",
				),
	];

	const percent = weightedPercent(checklist);
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
				label: "LLM リスク文脈を生成",
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
				label: "改善依頼を生成",
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
				label: "検証を実行",
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
				label: "修正計画を完了",
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
			label: "レポートを生成",
			action: "generate_report",
			targetId: scanRunId,
		},
	};
}
