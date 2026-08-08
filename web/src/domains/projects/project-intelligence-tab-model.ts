export const INTELLIGENCE_VIEW_IDS = [
	"priority",
	"investigate",
	"landscape",
	"guided",
] as const;

export type IntelligenceViewId = (typeof INTELLIGENCE_VIEW_IDS)[number];

export const INTELLIGENCE_TABS: ReadonlyArray<{
	id: IntelligenceViewId;
	number: string;
	label: string;
	description: string;
}> = [
	{
		id: "priority",
		number: "01",
		label: "判断優先",
		description: "現状と優先対応を短時間で判断します",
	},
	{
		id: "investigate",
		number: "02",
		label: "調査ビュー",
		description: "ファイル、Finding、Evidenceを掘り下げます",
	},
	{
		id: "landscape",
		number: "03",
		label: "リスクマップ",
		description: "モジュール単位のリスク分布を俯瞰します",
	},
	{
		id: "guided",
		number: "04",
		label: "ガイド方式",
		description: "Findingを一件ずつ手順に沿って確認します",
	},
];

export function parseIntelligenceViewId(value: unknown): IntelligenceViewId {
	return typeof value === "string" &&
		(INTELLIGENCE_VIEW_IDS as readonly string[]).includes(value)
		? (value as IntelligenceViewId)
		: "priority";
}

export function parseOptionalIntelligenceViewId(
	value: unknown,
): IntelligenceViewId | undefined {
	return typeof value === "string" &&
		(INTELLIGENCE_VIEW_IDS as readonly string[]).includes(value)
		? (value as IntelligenceViewId)
		: undefined;
}

export function parseFocusPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 1_024 ? trimmed : null;
}

export function parseOptionalFocusPath(value: unknown): string | undefined {
	return parseFocusPath(value) ?? undefined;
}
