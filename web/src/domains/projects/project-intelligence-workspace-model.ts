import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
	StaticIntelligenceSeverity,
} from "../../../../shared/schemas/static-intelligence.schema";
import type { StaticIntelligenceModuleCandidate } from "../../../../shared/schemas/static-intelligence-module.schema";
import type { Finding, FindingDecision } from "../../api";

export const INTELLIGENCE_SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
] as const satisfies readonly StaticIntelligenceSeverity[];

export const INTELLIGENCE_SEVERITY_ORDER: Record<
	StaticIntelligenceSeverity,
	number
> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
	info: 4,
	unknown: 5,
};

export type GuidedDecision = "false_positive" | "deferred" | "needs_fix";

export const GUIDED_DECISION_ACTIONS: ReadonlyArray<{
	value: GuidedDecision;
	label: string;
	description: string;
}> = [
	{
		value: "needs_fix",
		label: "問題として確認",
		description: "実装改善候補として互換記録を保存します",
	},
	{
		value: "false_positive",
		label: "誤検知",
		description: "ツールノイズとして互換記録を保存します",
	},
	{
		value: "deferred",
		label: "保留",
		description: "後続確認が必要な記録として保存します",
	},
];

export const GUIDED_REASON_OPTIONS: ReadonlyArray<{
	value: FindingDecision["reason"];
	label: string;
}> = [
	{ value: "confirmed_by_evidence", label: "証跡で確認済み" },
	{ value: "confirmed_by_review", label: "レビューで確認済み" },
	{ value: "insufficient_evidence", label: "証跡不足" },
	{ value: "environment_specific", label: "環境依存" },
	{ value: "tool_noise", label: "ツールのノイズ" },
	{ value: "not_exploitable", label: "悪用困難" },
	{ value: "accepted_risk", label: "既知リスク" },
	{ value: "other", label: "その他" },
];

export type PriorityPresentation = {
	tone: "danger" | "warning" | "success";
	title: string;
	description: string;
	highRiskFindingCount: number;
	topFiles: FileRiskIndexEntry[];
};

export function normalizeIntelligenceSeverity(
	value: unknown,
): StaticIntelligenceSeverity {
	return typeof value === "string" &&
		(INTELLIGENCE_SEVERITIES as readonly string[]).includes(value)
		? (value as StaticIntelligenceSeverity)
		: "unknown";
}

export function sortFileRiskEntries(
	entries: readonly FileRiskIndexEntry[],
): FileRiskIndexEntry[] {
	return [...entries].sort(
		(a, b) =>
			INTELLIGENCE_SEVERITY_ORDER[a.maxSeverity] -
				INTELLIGENCE_SEVERITY_ORDER[b.maxSeverity] ||
			b.findingCount - a.findingCount ||
			a.path.localeCompare(b.path),
	);
}

export function buildPriorityPresentation(
	exportPayload: StaticIntelligenceExportV1,
	degradedReasons: readonly string[],
): PriorityPresentation {
	const highRiskFindingIds = new Set(
		exportPayload.graph.nodes
			.filter(
				(node) =>
					node.kind === "finding" &&
					["critical", "high"].includes(
						normalizeIntelligenceSeverity(node.severity),
					),
			)
			.map((node) => node.sourceId ?? node.id),
	);
	let highRiskFindingCount = highRiskFindingIds.size;
	if (highRiskFindingCount === 0) {
		let findingsWithoutIds = 0;
		for (const entry of exportPayload.fileRiskIndex) {
			if (!["critical", "high"].includes(entry.maxSeverity)) continue;
			if (entry.findingIds.length > 0) {
				for (const findingId of entry.findingIds)
					highRiskFindingIds.add(findingId);
			} else {
				findingsWithoutIds += entry.findingCount;
			}
		}
		highRiskFindingCount = highRiskFindingIds.size + findingsWithoutIds;
	}
	const topFiles = sortFileRiskEntries(exportPayload.fileRiskIndex).slice(0, 5);

	if (highRiskFindingCount > 0) {
		return {
			tone: "danger",
			title: "優先して確認するFindingがあります",
			description: `Critical / High のFindingが${highRiskFindingCount}件あります。影響の大きいファイルから調査してください。${
				degradedReasons.length > 0
					? ` なお、${degradedReasons.length}件の生成上の制約があります。`
					: ""
			}`,
			highRiskFindingCount,
			topFiles,
		};
	}
	if (degradedReasons.length > 0) {
		return {
			tone: "warning",
			title: "分析結果の一部を確認できません",
			description: `${degradedReasons.length}件の生成上の制約があります。利用可能な結果を確認し、必要に応じて分析を更新してください。`,
			highRiskFindingCount,
			topFiles,
		};
	}
	return {
		tone: "success",
		title: "現時点で優先度の高いFindingはありません",
		description:
			"現在の生成物ではCritical / HighのFindingは確認されていません。必要に応じて調査ビューで詳細を確認してください。",
		highRiskFindingCount: 0,
		topFiles,
	};
}

export function getFindingPath(finding: Finding): string | null {
	const location = finding.primaryLocation;
	if (!location || typeof location !== "object") return null;
	const path = (location as Record<string, unknown>).path;
	return typeof path === "string" && path.trim() ? path : null;
}

export function formatFindingLocation(finding: Finding): string {
	const path = getFindingPath(finding) ?? "場所不明";
	const location = finding.primaryLocation as Record<string, unknown> | null;
	const line = location?.startLine;
	return typeof line === "number" || typeof line === "string"
		? `${path}:${line}`
		: path;
}

export type FindingIndex = {
	byId: Map<string, Finding>;
	byPath: Map<string, Finding[]>;
};

export function buildFindingIndex(findings: readonly Finding[]): FindingIndex {
	const byId = new Map<string, Finding>();
	const byPath = new Map<string, Finding[]>();
	for (const finding of findings) {
		byId.set(finding.id, finding);
		const path = getFindingPath(finding);
		if (!path) continue;
		const entries = byPath.get(path) ?? [];
		entries.push(finding);
		byPath.set(path, entries);
	}
	for (const entries of byPath.values()) {
		entries.sort(compareFindings);
	}
	return { byId, byPath };
}

export type RiskMatrixRow = {
	id: string;
	label: string;
	pathPrefix: string;
	fileRefs: string[];
	findingIds: string[];
	counts: Record<StaticIntelligenceSeverity, number>;
	total: number;
	maxSeverity: StaticIntelligenceSeverity;
	approximate: boolean;
};

const emptySeverityCounts = (): Record<StaticIntelligenceSeverity, number> => ({
	critical: 0,
	high: 0,
	medium: 0,
	low: 0,
	info: 0,
	unknown: 0,
});

function compareMatrixRows(a: RiskMatrixRow, b: RiskMatrixRow): number {
	return (
		INTELLIGENCE_SEVERITY_ORDER[a.maxSeverity] -
			INTELLIGENCE_SEVERITY_ORDER[b.maxSeverity] ||
		b.total - a.total ||
		a.label.localeCompare(b.label)
	);
}

export function buildRiskMatrix(
	modules: readonly StaticIntelligenceModuleCandidate[],
	exportPayload: StaticIntelligenceExportV1,
): RiskMatrixRow[] {
	const severityByFindingId = new Map<string, StaticIntelligenceSeverity>();
	for (const node of exportPayload.graph.nodes) {
		if (node.kind !== "finding") continue;
		severityByFindingId.set(
			node.sourceId ?? node.id,
			normalizeIntelligenceSeverity(node.severity),
		);
	}

	if (modules.length === 0) {
		return exportPayload.fileRiskIndex
			.map((entry) => {
				const counts = emptySeverityCounts();
				const findingIds = [...new Set(entry.findingIds)];
				if (findingIds.length === 0 && entry.findingCount > 0) {
					counts[entry.maxSeverity] = entry.findingCount;
				} else {
					for (const findingId of findingIds) {
						counts[severityByFindingId.get(findingId) ?? "unknown"] += 1;
					}
				}
				return {
					id: entry.path,
					label: entry.path.split("/").at(-1) ?? entry.path,
					pathPrefix: entry.path,
					fileRefs: [entry.path],
					findingIds,
					counts,
					total: findingIds.length || entry.findingCount,
					maxSeverity: entry.maxSeverity,
					approximate: true,
				};
			})
			.sort(compareMatrixRows);
	}

	return modules
		.map((module) => {
			const counts = emptySeverityCounts();
			const findingIds = [...new Set(module.risk.findingIds)];
			for (const findingId of findingIds) {
				counts[severityByFindingId.get(findingId) ?? "unknown"] += 1;
			}
			return {
				id: module.id,
				label: module.label,
				pathPrefix: module.pathPrefix,
				fileRefs: [...new Set(module.risk.fileRefs)],
				findingIds,
				counts,
				total: findingIds.length,
				maxSeverity: module.risk.maxSeverity,
				approximate: false,
			};
		})
		.sort(compareMatrixRows);
}

export function compareFindings(a: Finding, b: Finding): number {
	return (
		INTELLIGENCE_SEVERITY_ORDER[a.severity] -
			INTELLIGENCE_SEVERITY_ORDER[b.severity] ||
		(getFindingPath(a) ?? "").localeCompare(getFindingPath(b) ?? "") ||
		a.id.localeCompare(b.id)
	);
}

export function buildGuidedQueue(findings: readonly Finding[]): Finding[] {
	return [...findings].sort(
		(a, b) =>
			Number(Boolean(a.latestDecision)) - Number(Boolean(b.latestDecision)) ||
			compareFindings(a, b),
	);
}

export function buildGuidedVisibleQueue(
	findings: readonly Finding[],
	options: {
		scope: "undecided" | "all";
		severity: string;
		pinnedFindingId: string | null;
	},
): Finding[] {
	const filtered = findings.filter(
		(finding) =>
			(options.scope === "all" ||
				!finding.latestDecision ||
				finding.id === options.pinnedFindingId) &&
			(options.severity === "all" || finding.severity === options.severity),
	);
	const sorted = buildGuidedQueue(filtered);
	if (options.scope !== "undecided" || !options.pinnedFindingId) return sorted;
	const pinned = sorted.find(
		(finding) => finding.id === options.pinnedFindingId,
	);
	if (!pinned?.latestDecision) return sorted;
	return [
		pinned,
		...sorted.filter((finding) => finding.id !== options.pinnedFindingId),
	];
}

export function countGuidedProgress(findings: readonly Finding[]): {
	completed: number;
	total: number;
	remaining: number;
} {
	const completed = findings.filter((finding) => finding.latestDecision).length;
	return {
		completed,
		total: findings.length,
		remaining: findings.length - completed,
	};
}
