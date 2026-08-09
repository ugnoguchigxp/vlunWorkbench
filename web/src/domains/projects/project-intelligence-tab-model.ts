export const INTELLIGENCE_VIEW_IDS = [
	"overview",
	"modules",
	"relationships",
	"handoff",
] as const;

export type IntelligenceViewId = (typeof INTELLIGENCE_VIEW_IDS)[number];

export const INTELLIGENCE_TABS: ReadonlyArray<{
	id: IntelligenceViewId;
	number: string;
	label: string;
	description: string;
}> = [
	{
		id: "overview",
		number: "01",
		label: "構造サマリー",
		description: "解析範囲とプロジェクト構造を把握します",
	},
	{
		id: "modules",
		number: "02",
		label: "モジュール",
		description: "モジュール候補、ファイル、依存関係を探索します",
	},
	{
		id: "relationships",
		number: "03",
		label: "関係マップ",
		description: "モジュール依存と診断証跡の関係を確認します",
	},
	{
		id: "handoff",
		number: "04",
		label: "Ontology連携",
		description: "NightWorkersへ渡す構造候補と準備状態を確認します",
	},
];

const LEGACY_VIEW_ALIASES: Readonly<Record<string, IntelligenceViewId>> = {
	priority: "overview",
	investigate: "modules",
	landscape: "relationships",
	guided: "handoff",
};

export function parseIntelligenceViewId(value: unknown): IntelligenceViewId {
	return parseOptionalIntelligenceViewId(value) ?? "overview";
}

export function parseOptionalIntelligenceViewId(
	value: unknown,
): IntelligenceViewId | undefined {
	return typeof value === "string" &&
		(INTELLIGENCE_VIEW_IDS as readonly string[]).includes(value)
		? (value as IntelligenceViewId)
		: typeof value === "string"
			? LEGACY_VIEW_ALIASES[value]
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

export function parseModuleId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= 256 ? trimmed : null;
}

export function parseOptionalModuleId(value: unknown): string | undefined {
	return parseModuleId(value) ?? undefined;
}
