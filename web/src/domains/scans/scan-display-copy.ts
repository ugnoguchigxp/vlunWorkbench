const findingTitleLabels: Record<string, string> = {
	"Missing common security header": "一般的なセキュリティヘッダーが不足",
	"Sensitive common path is reachable": "機微な共通パスに到達可能",
	"Unexpected server error response": "予期しないサーバーエラー応答",
	"Cookie is missing recommended security attributes":
		"Cookie の推奨セキュリティ属性が不足",
	"Wildcard CORS policy observed": "ワイルドカード CORS ポリシーを検出",
};

const severityLabels: Record<string, string> = {
	critical: "緊急",
	high: "高",
	medium: "中",
	low: "低",
	info: "情報",
	informational: "情報",
	unknown: "不明",
};

export const formatFindingTitle = (title: string): string =>
	findingTitleLabels[title] ?? title;

export const formatSeverityLabel = (
	severity: string | null | undefined,
): string =>
	severityLabels[(severity || "unknown").toLowerCase()] ?? String(severity);
