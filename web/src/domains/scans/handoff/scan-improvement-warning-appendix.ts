import type { ScanReview } from "../../../api";

export type ScanImprovementWarningGroup = {
	warningGroupId: string;
	kind: "rollup" | "singleton";
	issueKind: string;
	title: string;
	severity: string;
	severityCounts: Record<string, number>;
	occurrenceCount: number;
	rawFindingCount: number;
	locationCount: number;
	locations: Array<{
		ref: string;
		severity: string;
		path?: string | null;
		startLine?: number | null;
		endLine?: number | null;
		startCol?: number | null;
		endCol?: number | null;
		resource?: string | null;
		method?: string | null;
		parameter?: string | null;
	}>;
};

const MAX_MARKDOWN_CHARS = 60_000;

export function readScanImprovementWarningGroups(
	review: ScanReview,
): ScanImprovementWarningGroup[] {
	const value = review.output?.warningGroups;
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const group = asRecord(item);
		if (
			!group ||
			typeof group.warningGroupId !== "string" ||
			!/^wg-\d{6}$/.test(group.warningGroupId) ||
			(group.kind !== "rollup" && group.kind !== "singleton") ||
			typeof group.issueKind !== "string" ||
			typeof group.title !== "string" ||
			typeof group.severity !== "string"
		) {
			return [];
		}
		const locations = Array.isArray(group.locations)
			? group.locations.flatMap((item) => {
					const location = asRecord(item);
					return location &&
						typeof location.ref === "string" &&
						typeof location.severity === "string"
						? [
								{
									ref: location.ref,
									severity: normalizeSeverity(location.severity),
									path: nullableString(location.path),
									startLine: positiveInteger(location.startLine),
									endLine: positiveInteger(location.endLine),
									startCol: positiveInteger(location.startCol),
									endCol: positiveInteger(location.endCol),
									resource: nullableString(location.resource),
									method: nullableString(location.method),
									parameter: nullableString(location.parameter),
								},
							]
						: [];
				})
			: [];
		const severityCounts = asRecord(group.severityCounts);
		const normalizedSeverityCounts: Record<string, number> = {};
		for (const [key, count] of Object.entries(severityCounts ?? {})) {
			const normalized = nonNegativeInteger(count);
			if (normalized !== null) normalizedSeverityCounts[key] = normalized;
		}
		return [
			{
				warningGroupId: group.warningGroupId,
				kind: group.kind,
				issueKind: group.issueKind,
				title: group.title,
				severity: normalizeSeverity(group.severity),
				severityCounts: normalizedSeverityCounts,
				occurrenceCount:
					nonNegativeInteger(group.occurrenceCount) ?? locations.length,
				rawFindingCount: nonNegativeInteger(group.rawFindingCount) ?? 0,
				locationCount: Math.max(
					nonNegativeInteger(group.locationCount) ?? locations.length,
					locations.length,
				),
				locations,
			},
		];
	});
}

export function appendWarningGroupAppendix(
	body: string,
	warningGroups: ScanImprovementWarningGroup[],
): string {
	if (warningGroups.length === 0) return `${body}\n`;
	const variants = [
		buildWarningGroupAppendix(warningGroups, null, 500),
		buildWarningGroupAppendix(warningGroups, 20, 240),
		buildWarningGroupAppendix(warningGroups, 3, 160),
		buildWarningGroupAppendix(warningGroups, 0, 80),
	];
	for (const appendix of variants) {
		const document = `${body}\n\n${appendix}\n`;
		if (document.length <= MAX_MARKDOWN_CHARS) return document;
	}
	return appendBudgetedWarningGroupSummary(body, warningGroups);
}

function buildWarningGroupAppendix(
	warningGroups: ScanImprovementWarningGroup[],
	maxLocations: number | null,
	maxTitleChars: number,
): string {
	const sections = warningGroups.map((group) =>
		renderWarningGroup(group, maxLocations, maxTitleChars),
	);
	return `## 警告と対象場所\n${sections.join("\n\n")}`;
}

function renderWarningGroup(
	group: ScanImprovementWarningGroup,
	maxLocations: number | null,
	maxTitleChars: number,
): string {
	const locations =
		maxLocations === null
			? group.locations
			: group.locations.slice(0, maxLocations);
	const omitted = Math.max(0, group.locationCount - locations.length);
	const title = escapeMarkdownText(group.title, maxTitleChars);
	const summary = `${inlineCode(group.warningGroupId)} / severity: ${escapeMarkdownText(group.severity, 40)} / 対象場所: ${group.locationCount}件`;
	const locationLines = locations.map(
		(location) =>
			`- ${inlineCode(location.ref)}（${escapeMarkdownText(location.severity, 40)}）`,
	);
	if (omitted > 0) {
		locationLines.push(
			`- ほか ${omitted} 件（完全な一覧は同時に保存されたJSONを参照）`,
		);
	}
	return `### ${title}\n${summary}\n${locationLines.join("\n")}`;
}

function appendBudgetedWarningGroupSummary(
	body: string,
	warningGroups: ScanImprovementWarningGroup[],
): string {
	if (body.length >= MAX_MARKDOWN_CHARS) {
		return `${body}\n\n## 警告と対象場所\n- 本文だけで上限目標を超えたため、完全な一覧は同時に保存されたJSONを参照してください。\n`;
	}
	const header = "## 警告と対象場所";
	const sections: string[] = [];
	for (const group of warningGroups) {
		const section = renderWarningGroup(group, 0, 60);
		const remaining = warningGroups.length - sections.length - 1;
		const note = `\n\n- 残り ${Math.max(0, remaining)} グループの完全な一覧は同時に保存されたJSONを参照してください。`;
		const candidate = `${body}\n\n${header}\n${[...sections, section].join("\n\n")}${note}\n`;
		if (candidate.length > MAX_MARKDOWN_CHARS) break;
		sections.push(section);
	}
	const omittedGroups = warningGroups.length - sections.length;
	const note =
		omittedGroups > 0
			? `\n\n- 残り ${omittedGroups} グループの完全な一覧は同時に保存されたJSONを参照してください。`
			: "";
	const document = `${body}\n\n${header}\n${sections.join("\n\n")}${note}\n`;
	return document.length <= MAX_MARKDOWN_CHARS ? document : `${body}\n`;
}

function escapeMarkdownText(value: string, maxChars: number): string {
	return value
		.replaceAll(/[\r\n\t]+/g, " ")
		.replaceAll(/[\\`*_[\]{}<>#+.!|()-]/g, "\\$&")
		.slice(0, maxChars);
}

function inlineCode(value: string): string {
	const normalized = value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
	const longestRun = Math.max(
		0,
		...[...normalized.matchAll(/`+/g)].map((match) => match[0].length),
	);
	const fence = "`".repeat(longestRun + 1);
	const content =
		normalized.startsWith("`") ||
		normalized.endsWith("`") ||
		normalized.startsWith(" ") ||
		normalized.endsWith(" ")
			? ` ${normalized} `
			: normalized;
	return `${fence}${content}${fence}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;
}

function nonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: null;
}

function normalizeSeverity(value: string): string {
	return value === "critical" ||
		value === "high" ||
		value === "medium" ||
		value === "low" ||
		value === "info" ||
		value === "unknown"
		? value
		: "unknown";
}
