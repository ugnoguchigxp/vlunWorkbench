import {
	getReportSectionDefinition,
	type ReportSectionId,
} from "../../../shared/report-sections";
import {
	type ScanImprovementRequest,
	scanImprovementRequestSchema,
} from "../../../shared/schemas/scan.schema";
import type { findingDecisions, findingEvidences } from "../../db/schema";

export type ReportBuilderOptions = {
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
	title?: string;
};

export const BUCKETS = [
	"needs_fix",
	"accepted",
	"deferred",
	"false_positive",
	"undecided",
] as const;
export const SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
] as const;

export const getBucketRank = (bucket: string) => {
	const idx = (BUCKETS as readonly string[]).indexOf(bucket);
	return idx === -1 ? 99 : idx;
};

export const getSeverityRank = (severity: string) => {
	const normalizedSeverity = severity.toLowerCase();
	const idx = (SEVERITIES as readonly string[]).indexOf(normalizedSeverity);
	return idx === -1 ? 99 : idx;
};

export const isKnownSeverity = (severity: string): boolean =>
	(SEVERITIES as readonly string[]).includes(severity.toLowerCase());

export const toInlineText = (value: unknown, fallback = "N/A"): string => {
	const text = String(value ?? fallback)
		.replace(/\s+/g, " ")
		.trim();
	return text || fallback;
};

export const escapeTableCell = (value: unknown): string => {
	return toInlineText(value).replaceAll("|", "\\|");
};

export const codeFenceFor = (content: string): string => {
	return content.includes("```") ? "````" : "```";
};

export const reportHeading = (id: ReportSectionId): string =>
	getReportSectionDefinition(id).markdownHeading;

export const reportAlternateHeading = (
	id: ReportSectionId,
): string | undefined =>
	getReportSectionDefinition(id).alternateMarkdownHeading;

export const getLocationPath = (location: unknown): string => {
	if (!location || typeof location !== "object") return "";
	const value = (location as Record<string, unknown>).path;
	return typeof value === "string" ? value : "";
};

export const getLocationStartLine = (location: unknown): number => {
	if (!location || typeof location !== "object") return 0;
	const value = (location as Record<string, unknown>).startLine;
	if (typeof value === "number") return value;
	if (typeof value === "string") return Number(value) || 0;
	return 0;
};

export const formatDateTime = (value: Date | null | undefined): string => {
	if (!value) return "N/A";
	return value.toISOString();
};

export type DiffReportContext = {
	kind: "commit" | "range" | "working_tree";
	baseSha: string;
	headSha: string | null;
	mergeBaseSha: string | null;
	targetDigest: string;
	coverage: {
		changed: number;
		scannable: number;
		deleted: number;
		excluded: number;
		unsupported: number;
		tooLarge: number;
	};
	tools: Array<{
		toolId: string;
		applicability: string;
		reasonCode: string | null;
		coverageEffect: string;
		status: string | null;
	}>;
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;

export const readDiffReportContext = (
	metadata: Record<string, unknown> | null | undefined,
): DiffReportContext | null => {
	const target = asRecord(metadata?.target);
	const coverage = asRecord(metadata?.diffCoverage);
	if (!target || !coverage) return null;
	const kind = target.kind;
	if (kind !== "commit" && kind !== "range" && kind !== "working_tree") {
		return null;
	}
	const coverageFields = [
		"changed",
		"scannable",
		"deleted",
		"excluded",
		"unsupported",
		"tooLarge",
	] as const;
	if (coverageFields.some((field) => typeof coverage[field] !== "number")) {
		return null;
	}
	const runtimeTools = new Map(
		Array.isArray(metadata?.stepResults)
			? metadata.stepResults.flatMap((value) => {
					const result = asRecord(value);
					return result?.kind === "static_tool" &&
						typeof result.toolId === "string"
						? [[result.toolId, result] as const]
						: [];
				})
			: [],
	);
	const tools = Array.isArray(metadata?.diffToolApplicability)
		? metadata.diffToolApplicability.flatMap((value) => {
				const tool = asRecord(value);
				const runtime =
					typeof tool?.toolId === "string"
						? runtimeTools.get(tool.toolId)
						: undefined;
				return tool &&
					typeof tool.toolId === "string" &&
					typeof tool.applicability === "string" &&
					typeof tool.coverageEffect === "string"
					? [
							{
								toolId: tool.toolId,
								applicability: tool.applicability,
								reasonCode:
									typeof tool.reasonCode === "string" ? tool.reasonCode : null,
								coverageEffect:
									typeof runtime?.coverageEffect === "string"
										? runtime.coverageEffect
										: tool.coverageEffect,
								status:
									typeof runtime?.status === "string" ? runtime.status : null,
							},
						]
					: [];
			})
		: [];
	return {
		kind,
		baseSha: toInlineText(target.baseSha),
		headSha: typeof target.headSha === "string" ? target.headSha : null,
		mergeBaseSha:
			typeof target.mergeBaseSha === "string" ? target.mergeBaseSha : null,
		targetDigest: toInlineText(target.targetDigest),
		coverage: Object.fromEntries(
			coverageFields.map((field) => [field, coverage[field] as number]),
		) as DiffReportContext["coverage"],
		tools,
	};
};

export const DECISION_LABELS: Record<string, string> = {
	needs_fix: "実装改善候補",
	accepted: "既知リスク記録",
	deferred: "後続確認記録",
	false_positive: "誤検知",
	undecided: "LLM handoff未作成",
};

export const SEVERITY_LABELS: Record<string, string> = {
	critical: "緊急",
	high: "高",
	medium: "中",
	low: "低",
	info: "情報",
	unknown: "不明",
};

export const EVIDENCE_STRENGTH_LABELS: Record<string, string> = {
	strong: "強い",
	moderate: "中程度",
	weak: "弱い",
	unknown: "不明",
};

export const FALSE_POSITIVE_LABELS: Record<string, string> = {
	low: "低い",
	medium: "中程度",
	high: "高い",
	unknown: "不明",
};

export const formatDecision = (value: string | null | undefined): string =>
	DECISION_LABELS[value || "undecided"] ??
	toInlineText(value, "LLM handoff未作成");

export const formatSeverity = (value: string | null | undefined): string =>
	SEVERITY_LABELS[(value || "unknown").toLowerCase()] ??
	toInlineText(value, "不明");

export const describeEvidenceKinds = (
	evidences: (typeof findingEvidences.$inferSelect)[],
): string => {
	if (evidences.length === 0) return "証跡は記録されていません";
	const counts = new Map<string, number>();
	for (const evidence of evidences) {
		counts.set(evidence.kind, (counts.get(evidence.kind) ?? 0) + 1);
	}
	return Array.from(counts.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([kind, count]) => `${kind} ${count}件`)
		.join("、");
};

export const buildRemediationFallback = (params: {
	bucket: string;
	severity: string;
	locationPath: string;
}): string => {
	const target = params.locationPath
		? `${params.locationPath} 周辺`
		: "該当コンポーネント";
	if (params.bucket === "false_positive") {
		return "誤検知として扱う場合も、根拠となるコード差分または運用上の前提を記録して再発時に再評価できるようにしてください。";
	}
	if (params.bucket === "deferred") {
		return `${target} の影響範囲を明確にし、保留期限と再確認条件を決めてから backlog に残してください。`;
	}
	if (params.severity === "critical" || params.severity === "high") {
		return `${target} を優先して修正し、入力検証、権限境界、秘密情報の扱いなど該当ルールが指摘している制御を追加してください。`;
	}
	return `${target} の実装意図と実際のデータフローを確認し、必要に応じて防御的なチェックやテストを追加してください。`;
};

export const readRemediationMetadata = (
	decision: typeof findingDecisions.$inferSelect | null,
): {
	status?: string;
	owner?: string | null;
	priority?: string;
	dueDate?: string | null;
	recommendedFix?: string | null;
} => {
	const remediation = decision?.metadata?.remediation;
	if (
		!remediation ||
		typeof remediation !== "object" ||
		Array.isArray(remediation)
	) {
		return {};
	}
	const record = remediation as Record<string, unknown>;
	return {
		status: typeof record.status === "string" ? record.status : undefined,
		owner: typeof record.owner === "string" ? record.owner : null,
		priority: typeof record.priority === "string" ? record.priority : undefined,
		dueDate: typeof record.dueDate === "string" ? record.dueDate : null,
		recommendedFix:
			typeof record.recommendedFix === "string" ? record.recommendedFix : null,
	};
};

export const readImprovementRequest = (
	output: Record<string, unknown> | null | undefined,
): ScanImprovementRequest | null => {
	const parsed = scanImprovementRequestSchema.safeParse(
		output?.improvementRequest,
	);
	return parsed.success ? parsed.data : null;
};

export const renderImprovementRequest = (
	lines: string[],
	request: ScanImprovementRequest,
) => {
	lines.push("### 改善依頼書");
	lines.push(`- **タイトル:** ${toInlineText(request.title)}`);
	lines.push(`- **目的:** ${toInlineText(request.objective)}`);
	if (request.scope.length > 0) {
		lines.push("- **対象範囲:**");
		for (const item of request.scope) {
			lines.push(`  - ${toInlineText(item)}`);
		}
	}
	if (request.priorityPlan.length > 0) {
		lines.push("");
		lines.push("### 優先順位");
		lines.push("| Priority | Finding IDs | Rationale |");
		lines.push("| --- | --- | --- |");
		for (const item of request.priorityPlan) {
			lines.push(
				`| ${escapeTableCell(item.priority)} | ${escapeTableCell(item.findingIds.join(", ") || "-")} | ${escapeTableCell(item.rationale)} |`,
			);
		}
	}
	if (request.implementationTasks.length > 0) {
		lines.push("");
		lines.push("### 実装タスク");
		for (const [index, task] of request.implementationTasks.entries()) {
			lines.push(`#### ${index + 1}. ${toInlineText(task.title)}`);
			lines.push(`- **内容:** ${toInlineText(task.body)}`);
			lines.push(
				`- **Finding IDs:** ${toInlineText(task.findingIds.join(", ") || "-")}`,
			);
			if (task.evidenceRefs.length > 0) {
				lines.push(
					`- **Evidence refs:** ${toInlineText(task.evidenceRefs.join(", "))}`,
				);
			}
		}
	}
	if (request.acceptanceCriteria.length > 0) {
		lines.push("");
		lines.push("### 受け入れ条件");
		for (const item of request.acceptanceCriteria) {
			lines.push(`- ${toInlineText(item)}`);
		}
	}
	if (request.verificationCommands.length > 0) {
		lines.push("");
		lines.push("### 検証コマンド");
		for (const item of request.verificationCommands) {
			lines.push(`- \`${item.replaceAll("`", "\\`")}\``);
		}
	}
	if (request.constraints.length > 0) {
		lines.push("");
		lines.push("### 制約");
		for (const item of request.constraints) {
			lines.push(`- ${toInlineText(item)}`);
		}
	}
	if (request.nonGoals.length > 0) {
		lines.push("");
		lines.push("### 非ゴール");
		for (const item of request.nonGoals) {
			lines.push(`- ${toInlineText(item)}`);
		}
	}
	lines.push("");
	lines.push("### Handoff Prompt");
	const fence = codeFenceFor(request.handoffPrompt);
	lines.push(fence);
	lines.push(request.handoffPrompt);
	lines.push(fence);
	lines.push("");
};
