export const DECISION_STATE_LABELS = {
	missing: "任意注釈なし",
	complete: "互換記録あり",
	needs_context: "追加証跡が必要",
} as const;

export const DECISION_LABELS = {
	accepted: "既知リスク記録",
	false_positive: "ツールノイズ記録",
	deferred: "後続確認記録",
	needs_fix: "実装改善候補",
	open: "任意注釈なし",
} as const;

export const REASON_LABELS = {
	confirmed_by_evidence: "証跡で確認済み",
	confirmed_by_review: "レビューで確認済み",
	insufficient_evidence: "証跡不足",
	environment_specific: "環境依存",
	tool_noise: "ツールのノイズ",
	not_exploitable: "悪用困難",
	accepted_risk: "既知リスク",
	other: "その他",
} as const;
