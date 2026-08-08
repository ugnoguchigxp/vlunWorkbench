import type { IntelligenceReadinessStatus } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { ProjectIntelligenceView } from "../../api";

export type ProjectOverviewTone =
	| "neutral"
	| "success"
	| "warning"
	| "danger"
	| "progress";

export type ProjectOverviewAction =
	| "start_scan"
	| "open_scan"
	| "generate_intelligence"
	| "retry_intelligence"
	| "open_intelligence";

export type ProjectOverviewPresentation = {
	scan: {
		status: string;
		tone: ProjectOverviewTone;
		title: string;
		description: string;
		action: ProjectOverviewAction;
		actionLabel: string;
	};
	intelligence: {
		status: string;
		tone: ProjectOverviewTone;
		title: string;
		description: string;
		action: ProjectOverviewAction | null;
		actionLabel: string | null;
		metrics: Array<{ label: string; value: string | number }>;
	};
};

type OverviewSource = Pick<
	ProjectIntelligenceView,
	"selectedScan" | "generation" | "export" | "readiness"
>;

export function buildProjectOverviewPresentation(
	view: OverviewSource | null,
): ProjectOverviewPresentation {
	const selectedScan = view?.selectedScan ?? null;
	if (!selectedScan) {
		return {
			scan: {
				status: "未実行",
				tone: "neutral",
				title: "スキャンはまだありません",
				description:
					"プロジェクトを検査するには、最初のスキャンを開始してください。",
				action: "start_scan",
				actionLabel: "スキャンを開始",
			},
			intelligence: {
				status: "スキャンが必要",
				tone: "neutral",
				title: "分析元のスキャンがありません",
				description: "Intelligenceは完了したスキャンをもとに生成されます。",
				action: null,
				actionLabel: null,
				metrics: [],
			},
		};
	}

	const scanStatus = scanStatusPresentation(selectedScan.status);
	const readinessStatus = view?.readiness.export.status ?? "missing";
	const scanInProgress =
		selectedScan.status === "running" || selectedScan.status === "queued";
	const intelligence = scanInProgress
		? pendingScanIntelligencePresentation()
		: intelligencePresentation(readinessStatus, Boolean(view?.generation));

	return {
		scan: {
			...scanStatus,
			title: selectedScan.profile,
			description: scanDescription(selectedScan.status),
			action: "open_scan",
			actionLabel:
				selectedScan.status === "running" || selectedScan.status === "queued"
					? "進捗を見る"
					: "スキャンを開く",
		},
		intelligence: {
			...intelligence,
			metrics:
				!scanInProgress && view?.export
					? [
							{
								label: "リスク",
								value: riskBandLabel(view.export.scanSummary.riskBand),
							},
							{
								label: "根拠品質",
								value: evidenceQualityLabel(
									view.export.scanSummary.evidenceQuality,
								),
							},
							{
								label: "Finding",
								value: view.export.scan.findingCount,
							},
							{
								label: "コード構造",
								value: readinessLabel(view.readiness.codeStructure.status),
							},
						]
					: [],
		},
	};
}

function pendingScanIntelligencePresentation(): Omit<
	ProjectOverviewPresentation["intelligence"],
	"metrics"
> {
	return {
		status: "スキャン完了待ち",
		tone: "progress",
		title: "スキャンを実行しています",
		description: "完了後にIntelligenceを生成できるようになります。",
		action: null,
		actionLabel: null,
	};
}

function scanStatusPresentation(status: string): {
	status: string;
	tone: ProjectOverviewTone;
} {
	switch (status) {
		case "completed":
			return { status: "完了", tone: "success" };
		case "running":
			return { status: "実行中", tone: "progress" };
		case "queued":
			return { status: "待機中", tone: "progress" };
		case "failed":
			return { status: "失敗", tone: "danger" };
		case "cancelled":
			return { status: "キャンセル済み", tone: "neutral" };
		default:
			return { status: "状態不明", tone: "neutral" };
	}
}

function scanDescription(status: string): string {
	switch (status) {
		case "completed":
			return "スキャン結果と保存された成果物を確認できます。";
		case "running":
			return "スキャンを実行しています。進捗を確認できます。";
		case "queued":
			return "スキャンの開始を待っています。";
		case "failed":
			return "スキャンが完了しませんでした。詳細を確認してください。";
		case "cancelled":
			return "このスキャンはキャンセルされました。";
		default:
			return "スキャンの状態を確認してください。";
	}
}

function intelligencePresentation(
	status: IntelligenceReadinessStatus,
	hasGeneration: boolean,
): Omit<ProjectOverviewPresentation["intelligence"], "metrics"> {
	if (!hasGeneration && status === "failed") {
		return {
			status: "生成失敗",
			tone: "danger",
			title: "Intelligenceを読み込めません",
			description:
				"保存済みデータが不完全です。Intelligenceを再生成してください。",
			action: "retry_intelligence",
			actionLabel: "生成を再試行",
		};
	}
	if (!hasGeneration || status === "missing") {
		return {
			status: "未生成",
			tone: "neutral",
			title: "分析データはまだありません",
			description:
				"完了したスキャンからリスク、根拠、コード構造を生成できます。",
			action: "generate_intelligence",
			actionLabel: "Intelligenceを生成",
		};
	}

	switch (status) {
		case "available":
			return {
				status: "利用可能",
				tone: "success",
				title: "分析データを利用できます",
				description: "リスク、根拠、コード構造を確認できます。",
				action: "open_intelligence",
				actionLabel: "Intelligenceを開く",
			};
		case "degraded":
			return {
				status: "一部利用可能",
				tone: "warning",
				title: "一部の分析データに制限があります",
				description: "利用可能な結果と制限事項を確認してください。",
				action: "open_intelligence",
				actionLabel: "Intelligenceを開く",
			};
		case "stale":
			return {
				status: "更新が必要",
				tone: "warning",
				title: "ソース更新後の分析がありません",
				description: "現在のソースに合わせてIntelligenceを再生成してください。",
				action: "retry_intelligence",
				actionLabel: "Intelligenceを再生成",
			};
		case "failed":
			return {
				status: "生成失敗",
				tone: "danger",
				title: "Intelligenceを利用できません",
				description: "生成処理を再試行してください。",
				action: "retry_intelligence",
				actionLabel: "生成を再試行",
			};
	}
	return {
		status: "未生成",
		tone: "neutral",
		title: "分析データはまだありません",
		description: "完了したスキャンからリスク、根拠、コード構造を生成できます。",
		action: "generate_intelligence",
		actionLabel: "Intelligenceを生成",
	};
}

function riskBandLabel(value: string): string {
	return (
		{
			none: "検出なし",
			low: "低",
			medium: "中",
			high: "高",
			critical: "重大",
			unknown: "不明",
		}[value] ?? value
	);
}

function evidenceQualityLabel(value: string): string {
	return (
		{
			none: "根拠なし",
			weak: "弱い",
			mixed: "混在",
			strong: "十分",
			unknown: "不明",
		}[value] ?? value
	);
}

function readinessLabel(value: IntelligenceReadinessStatus): string {
	return (
		{
			available: "利用可能",
			stale: "更新が必要",
			degraded: "一部利用可能",
			missing: "未生成",
			failed: "失敗",
		}[value] ?? value
	);
}
