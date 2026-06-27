export const REPORT_SECTION_DEFINITIONS = [
	{
		id: "executive-summary",
		label: "エグゼクティブサマリー",
		markdownHeading: "## Decision-grade Executive Summary",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "risk-ranking",
		label: "リスク順位",
		markdownHeading: "## Risk Ranking",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "evidence-quality",
		label: "証跡品質サマリー",
		markdownHeading: "## Evidence Quality Summary",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "finding-decisions",
		label: "LLM 実装引き継ぎ",
		markdownHeading: "## LLM Implementation Handoff",
		alternateMarkdownHeading: "## LLM Implementation Handoff",
	},
	{
		id: "remediation-plan",
		label: "修正計画",
		markdownHeading: "## Remediation Plan",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "verification-status",
		label: "検証状況",
		markdownHeading: "## Verification Status",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "scan-comparison",
		label: "scan 比較差分",
		markdownHeading: "## Scan Comparison Delta",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "zero-finding-coverage",
		label: "finding 0 件のカバレッジ説明",
		markdownHeading: "## Zero-Finding Coverage Explanation",
		alternateMarkdownHeading: undefined,
	},
	{
		id: "appendix",
		label: "付録",
		markdownHeading: "## Appendix",
		alternateMarkdownHeading: undefined,
	},
] as const;

export type ReportSectionId = (typeof REPORT_SECTION_DEFINITIONS)[number]["id"];

export const REPORT_SECTION_IDS = REPORT_SECTION_DEFINITIONS.map(
	(section) => section.id,
);

export const getReportSectionDefinition = (id: ReportSectionId) =>
	REPORT_SECTION_DEFINITIONS.find((section) => section.id === id) ??
	REPORT_SECTION_DEFINITIONS[0];
