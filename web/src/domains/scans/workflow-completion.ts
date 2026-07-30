import type {
	AutomatedDiagnosticRun,
	DiagnosticReport,
	Finding,
	ScanReport,
	ScanRun,
} from "../../api";
import type { CoverageSummary } from "./coverage-summary";
import type { EvidenceQualityView } from "./evidence-quality";
import type { RemediationPlanView } from "./remediation-plan";

export type WorkflowCompletion = {
	scanRunId: string;
	stage:
		| "scan_running"
		| "diagnostic_running"
		| "diagnostic_retry"
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
			| "inspect_coverage"
			| "retry_diagnostic";
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
	automatedDiagnostics?: AutomatedDiagnosticRun[];
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

const notApplicable = (
	id: string,
	label: string,
	weight: number,
	explanation: string,
) => ({
	id,
	label,
	status: "not_applicable" as const,
	weight,
	explanation,
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

	const latestDiagnostic = input.automatedDiagnostics?.[0] ?? null;
	const automaticRequested =
		input.scanRun.metadata?.automaticDiagnosticRequested === true ||
		Boolean(latestDiagnostic);
	const diagnosticCompleted =
		latestDiagnostic?.status === "completed" ||
		latestDiagnostic?.status === "completed_with_limitations";
	const diagnosticFailed = latestDiagnostic?.status === "failed";
	const checklist: WorkflowCompletion["checklist"] = [
		complete(
			"scan",
			"scanner 実行完了",
			20,
			`scanner 出力と ${input.findings.length} 件の正規化 finding を保存しました。`,
		),
		complete(
			"aggregate",
			"決定論的診断",
			20,
			"scanner の severity、evidence、coverage を変更せず統合しました。",
		),
		diagnosticCompleted
			? complete(
					"llm",
					"証跡制約付き LLM 診断",
					35,
					latestDiagnostic.status === "completed_with_limitations"
						? `LLM 診断は制約付きで完了しました: ${latestDiagnostic.limitationCodes.join(", ")}`
						: "保存済み証跡だけを使った criticality と remediation の評価が完了しました。",
				)
			: diagnosticFailed
				? blocked(
						"llm",
						"証跡制約付き LLM 診断",
						35,
						latestDiagnostic.errorMessage ??
							"LLM 診断が失敗しました。deterministic 結果は保持されています。",
						"再実行可能",
						latestDiagnostic.id,
					)
				: automaticRequested
					? incomplete(
							"llm",
							"証跡制約付き LLM 診断",
							35,
							"LLM criticality 診断を自動実行しています。人手の承認は不要です。",
							"実行中",
						)
					: notApplicable(
							"llm",
							"証跡制約付き LLM 診断",
							35,
							"この既存 scan では自動診断が要求されていません。",
						),
		generatedReport
			? complete(
					"report",
					"統合レポート",
					25,
					"scanner 結果と利用可能な LLM 診断を含むレポートを保存しました。",
				)
			: incomplete(
					"report",
					"統合レポート",
					25,
					automaticRequested
						? "自動診断 pipeline がレポートを生成しています。"
						: "既存 scan のレポートを生成できます。",
				),
	];
	const percent = weightedPercent(checklist);

	if (diagnosticFailed) {
		return {
			scanRunId,
			stage: "diagnostic_retry",
			percent,
			checklist,
			nextBestAction: {
				label: "自動診断を再実行",
				action: "retry_diagnostic",
				targetId: scanRunId,
			},
		};
	}
	if (automaticRequested && !diagnosticCompleted) {
		return {
			scanRunId,
			stage: "diagnostic_running",
			percent,
			checklist,
			nextBestAction: null,
		};
	}
	if (generatedReport) {
		return {
			scanRunId,
			stage: "report_generated",
			percent: 100,
			checklist,
			nextBestAction: null,
		};
	}
	return {
		scanRunId,
		stage: "report_ready",
		percent: Math.max(percent, 75),
		checklist,
		nextBestAction: {
			label: "レポートを生成",
			action: "generate_report",
			targetId: scanRunId,
		},
	};
}
