import { eq, inArray } from "drizzle-orm";
import {
	type ScanImprovementRequest,
	scanImprovementRequestSchema,
} from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import {
	dastEvidence,
	dastRuns,
	dynamicRuns,
	findingDecisions,
	findingEvidences,
	findingReviews,
	findings,
	projects,
	reproductionRuns,
	scanArtifacts,
	scanReviews,
	scanRuns,
	toolRuns,
} from "../../db/schema";
import { getProfileById } from "./profiles";

export type ReportBuilderOptions = {
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
	title?: string;
};

const BUCKETS = [
	"needs_fix",
	"accepted",
	"deferred",
	"false_positive",
	"undecided",
] as const;
const SEVERITIES = [
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unknown",
] as const;

const getBucketRank = (bucket: string) => {
	const idx = (BUCKETS as readonly string[]).indexOf(bucket);
	return idx === -1 ? 99 : idx;
};

const getSeverityRank = (severity: string) => {
	const normalizedSeverity = severity.toLowerCase();
	const idx = (SEVERITIES as readonly string[]).indexOf(normalizedSeverity);
	return idx === -1 ? 99 : idx;
};

const isKnownSeverity = (severity: string): boolean =>
	(SEVERITIES as readonly string[]).includes(severity.toLowerCase());

const toInlineText = (value: unknown, fallback = "N/A"): string => {
	const text = String(value ?? fallback)
		.replace(/\s+/g, " ")
		.trim();
	return text || fallback;
};

const escapeTableCell = (value: unknown): string => {
	return toInlineText(value).replaceAll("|", "\\|");
};

const codeFenceFor = (content: string): string => {
	return content.includes("```") ? "````" : "```";
};

const getLocationPath = (location: unknown): string => {
	if (!location || typeof location !== "object") return "";
	const value = (location as Record<string, unknown>).path;
	return typeof value === "string" ? value : "";
};

const getLocationStartLine = (location: unknown): number => {
	if (!location || typeof location !== "object") return 0;
	const value = (location as Record<string, unknown>).startLine;
	if (typeof value === "number") return value;
	if (typeof value === "string") return Number(value) || 0;
	return 0;
};

const formatDateTime = (value: Date | null | undefined): string => {
	if (!value) return "N/A";
	return value.toISOString();
};

const DECISION_LABELS: Record<string, string> = {
	needs_fix: "修正が必要",
	accepted: "リスク受容",
	deferred: "対応保留",
	false_positive: "誤検知",
	undecided: "未判断",
};

const SEVERITY_LABELS: Record<string, string> = {
	critical: "緊急",
	high: "高",
	medium: "中",
	low: "低",
	info: "情報",
	unknown: "不明",
};

const EVIDENCE_STRENGTH_LABELS: Record<string, string> = {
	strong: "強い",
	moderate: "中程度",
	weak: "弱い",
	unknown: "不明",
};

const FALSE_POSITIVE_LABELS: Record<string, string> = {
	low: "低い",
	medium: "中程度",
	high: "高い",
	unknown: "不明",
};

const formatDecision = (value: string | null | undefined): string =>
	DECISION_LABELS[value || "undecided"] ?? toInlineText(value, "未判断");

const formatSeverity = (value: string | null | undefined): string =>
	SEVERITY_LABELS[(value || "unknown").toLowerCase()] ??
	toInlineText(value, "不明");

const describeEvidenceKinds = (
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

const buildRemediationFallback = (params: {
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

const readRemediationMetadata = (
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

const readImprovementRequest = (
	output: Record<string, unknown> | null | undefined,
): ScanImprovementRequest | null => {
	const parsed = scanImprovementRequestSchema.safeParse(
		output?.improvementRequest,
	);
	return parsed.success ? parsed.data : null;
};

const renderImprovementRequest = (
	lines: string[],
	request: ScanImprovementRequest,
) => {
	lines.push("## 改善依頼書");
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

export async function buildMarkdownReport(
	db: AppDatabase,
	scanRunId: string,
	options: ReportBuilderOptions,
): Promise<string> {
	// 1. Fetch main entities
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId));
	if (!scanRun) {
		throw new Error(`Scan run not found: ${scanRunId}`);
	}

	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.id, scanRun.projectId));
	if (!project) {
		throw new Error(`Project not found for scan run: ${scanRunId}`);
	}

	const tools = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, scanRunId));
	const rawFindings = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, scanRunId));
	const allArtifacts = await db
		.select()
		.from(scanArtifacts)
		.where(eq(scanArtifacts.scanRunId, scanRunId));

	// 2. Fetch related entities for findings (handles empty findings list safely)
	let allEvidences: (typeof findingEvidences.$inferSelect)[] = [];
	let allReviews: (typeof findingReviews.$inferSelect)[] = [];
	let allDecisions: (typeof findingDecisions.$inferSelect)[] = [];
	let allDastEvidence: (typeof dastEvidence.$inferSelect)[] = [];

	if (rawFindings.length > 0) {
		const findingIds = rawFindings.map((f) => f.id);
		allEvidences = await db
			.select()
			.from(findingEvidences)
			.where(inArray(findingEvidences.findingId, findingIds));
		allReviews = await db
			.select()
			.from(findingReviews)
			.where(inArray(findingReviews.findingId, findingIds));
		allDecisions = await db
			.select()
			.from(findingDecisions)
			.where(inArray(findingDecisions.findingId, findingIds));
		allDastEvidence = await db
			.select()
			.from(dastEvidence)
			.where(inArray(dastEvidence.findingId, findingIds));
	}

	const allReproRuns = await db
		.select()
		.from(reproductionRuns)
		.where(eq(reproductionRuns.scanRunId, scanRunId));

	const allDynamicRuns = await db
		.select()
		.from(dynamicRuns)
		.where(eq(dynamicRuns.scanRunId, scanRunId));

	const allDastRuns = await db
		.select()
		.from(dastRuns)
		.where(eq(dastRuns.scanRunId, scanRunId));
	const allScanReviews = await db
		.select()
		.from(scanReviews)
		.where(eq(scanReviews.scanRunId, scanRunId));
	const latestImprovementRequest =
		allScanReviews
			.filter((review) => review.status === "completed")
			.sort((a, b) => {
				const timeA = a.createdAt ? a.createdAt.getTime() : 0;
				const timeB = b.createdAt ? b.createdAt.getTime() : 0;
				if (timeB !== timeA) return timeB - timeA;
				return b.id.localeCompare(a.id);
			})
			.map((review) => readImprovementRequest(review.output))
			.find((request) => request !== null) ?? null;

	// Helper to get latest completed review: sorted by createdAt desc, id desc
	const getLatestCompletedReview = (findingId: string) => {
		const reviews = allReviews.filter(
			(r) => r.findingId === findingId && r.status === "completed",
		);
		if (reviews.length === 0) return null;
		return reviews.sort((a, b) => {
			const timeA = a.createdAt ? a.createdAt.getTime() : 0;
			const timeB = b.createdAt ? b.createdAt.getTime() : 0;
			if (timeB !== timeA) return timeB - timeA;
			return b.id.localeCompare(a.id);
		})[0];
	};

	// Helper to get latest decision: sorted by createdAt desc, id desc
	const getLatestDecision = (findingId: string) => {
		const decisions = allDecisions.filter((d) => d.findingId === findingId);
		if (decisions.length === 0) return null;
		return decisions.sort((a, b) => {
			const timeA = a.createdAt ? a.createdAt.getTime() : 0;
			const timeB = b.createdAt ? b.createdAt.getTime() : 0;
			if (timeB !== timeA) return timeB - timeA;
			return b.id.localeCompare(a.id);
		})[0];
	};

	// 3. Process findings into decision buckets
	const processedFindings = rawFindings.map((fnd) => {
		const latestDecision = getLatestDecision(fnd.id);
		const latestCompletedReview = getLatestCompletedReview(fnd.id);
		const evidences = allEvidences
			.filter((e) => e.findingId === fnd.id)
			.sort((a, b) => {
				const kindDiff = a.kind.localeCompare(b.kind);
				if (kindDiff !== 0) return kindDiff;
				const titleDiff = a.title.localeCompare(b.title);
				if (titleDiff !== 0) return titleDiff;
				const timeA = a.createdAt ? a.createdAt.getTime() : 0;
				const timeB = b.createdAt ? b.createdAt.getTime() : 0;
				if (timeA !== timeB) return timeA - timeB;
				return a.id.localeCompare(b.id);
			});

		const bucket = latestDecision ? latestDecision.decision : "undecided";

		return {
			finding: fnd,
			latestDecision,
			latestCompletedReview,
			evidences,
			bucket,
		};
	});

	// Count statistics for the summary table
	const stats = {
		needs_fix: processedFindings.filter((f) => f.bucket === "needs_fix").length,
		accepted: processedFindings.filter((f) => f.bucket === "accepted").length,
		deferred: processedFindings.filter((f) => f.bucket === "deferred").length,
		false_positive: processedFindings.filter(
			(f) => f.bucket === "false_positive",
		).length,
		undecided: processedFindings.filter((f) => f.bucket === "undecided").length,
	};
	const severityStats = {
		critical: rawFindings.filter((f) => f.severity.toLowerCase() === "critical")
			.length,
		high: rawFindings.filter((f) => f.severity.toLowerCase() === "high").length,
		medium: rawFindings.filter((f) => f.severity.toLowerCase() === "medium")
			.length,
		low: rawFindings.filter((f) => f.severity.toLowerCase() === "low").length,
		info: rawFindings.filter((f) => f.severity.toLowerCase() === "info").length,
		unknown: rawFindings.filter((f) => !isKnownSeverity(f.severity)).length,
	};
	const reviewedFindingCount = processedFindings.filter(
		(f) => f.latestCompletedReview,
	).length;
	const decidedFindingCount = processedFindings.filter(
		(f) => f.latestDecision,
	).length;

	// Sort findings using the deterministic policy
	const deterministicSort = (
		a: (typeof processedFindings)[0],
		b: (typeof processedFindings)[0],
	) => {
		const bRankA = getBucketRank(a.bucket);
		const bRankB = getBucketRank(b.bucket);
		if (bRankA !== bRankB) return bRankA - bRankB;

		const sRankA = getSeverityRank(a.finding.severity);
		const sRankB = getSeverityRank(b.finding.severity);
		if (sRankA !== sRankB) return sRankA - sRankB;

		const toolDiff = a.finding.sourceTool.localeCompare(b.finding.sourceTool);
		if (toolDiff !== 0) return toolDiff;

		const ruleDiff = a.finding.ruleId.localeCompare(b.finding.ruleId);
		if (ruleDiff !== 0) return ruleDiff;

		const locA = getLocationPath(a.finding.primaryLocation);
		const locB = getLocationPath(b.finding.primaryLocation);
		const pathDiff = locA.localeCompare(locB);
		if (pathDiff !== 0) return pathDiff;

		const lineA = getLocationStartLine(a.finding.primaryLocation);
		const lineB = getLocationStartLine(b.finding.primaryLocation);
		if (lineA !== lineB) return lineA - lineB;

		return a.finding.id.localeCompare(b.finding.id);
	};

	const sortedFindings = [...processedFindings].sort(deterministicSort);

	// Filter findings according to options
	const activeFindings = sortedFindings.filter(
		(f) => f.bucket === "needs_fix" || f.bucket === "accepted",
	);
	const deferredFindings = sortedFindings.filter(
		(f) => f.bucket === "deferred",
	);
	const falsePositiveFindings = sortedFindings.filter(
		(f) => f.bucket === "false_positive",
	);
	const undecidedFindings = sortedFindings.filter(
		(f) => f.bucket === "undecided",
	);

	const reportTitle = toInlineText(options.title, "セキュリティレポート");

	// Start building Markdown content
	const lines: string[] = [];
	lines.push(`# ${reportTitle}`);
	lines.push("");

	// Scan Summary
	const profileOutcome = (scanRun.metadata?.profileOutcome as string) || "N/A";
	lines.push("## スキャン概要");
	lines.push(`- **プロジェクト名:** ${toInlineText(project.name)}`);
	lines.push(`- **スキャンプロファイル:** ${toInlineText(scanRun.profile)}`);
	lines.push(
		`- **プロファイル結果:** ${toInlineText(profileOutcome.toUpperCase())}`,
	);
	lines.push(`- **状態:** ${toInlineText(scanRun.status)}`);
	lines.push(`- **開始日時:** ${formatDateTime(scanRun.startedAt)}`);
	lines.push(`- **完了日時:** ${formatDateTime(scanRun.completedAt)}`);
	lines.push("");

	lines.push("## 全体考察");
	if (rawFindings.length === 0) {
		lines.push(
			"- **結論:** 今回のスキャン範囲では、対応が必要な指摘事項は発見されませんでした。",
		);
		lines.push(
			"- この結論は、実行したプロファイル、対象範囲、ツール設定、取得済み artifact に基づくものです。未実行の観点やスキャン対象外のコードまで含めた完全な安全性を証明するものではありません。",
		);
	} else {
		const urgentCount = severityStats.critical + severityStats.high;
		lines.push(
			`- 検出件数は ${rawFindings.length} 件で、このうち緊急または高 severity は ${urgentCount} 件です。まず「修正が必要」に分類された finding と未判断の高 severity finding を優先して確認してください。`,
		);
		lines.push(
			`- 判断状況は、修正が必要 ${stats.needs_fix} 件、リスク受容 ${stats.accepted} 件、対応保留 ${stats.deferred} 件、誤検知 ${stats.false_positive} 件、未判断 ${stats.undecided} 件です。未判断が残る場合は、証跡の妥当性と実行時到達可能性を追加確認する必要があります。`,
		);
		lines.push(
			`- LLMレビュー済みは ${reviewedFindingCount} 件、意思決定済みは ${decidedFindingCount} 件です。レビューがない finding は、静的検出と保存済み証跡だけを根拠にしているため、修正前に影響範囲の読み合わせを推奨します。`,
		);
	}
	lines.push("");

	if (latestImprovementRequest) {
		renderImprovementRequest(lines, latestImprovementRequest);
	}

	lines.push("## Decision-grade Executive Summary");
	if (rawFindings.length === 0) {
		lines.push(
			"- **Risk posture:** informational。finding は 0 件ですが、スキャン範囲と診断カバレッジの制約を前提に判断してください。",
		);
	} else {
		const highestSeverity =
			SEVERITIES.find((severity) => severityStats[severity] > 0) ?? "unknown";
		const strongReviewCount = processedFindings.filter(
			(item) =>
				item.latestCompletedReview?.evidenceStrength?.level === "strong",
		).length;
		const weakOrMissingDecisionGradeEvidence = processedFindings.filter(
			(item) =>
				item.evidences.length === 0 ||
				item.latestCompletedReview?.evidenceStrength?.level === "weak" ||
				!item.latestCompletedReview,
		).length;
		lines.push(
			`- **Risk posture:** ${formatSeverity(highestSeverity)}。修正対象 ${stats.needs_fix} 件、未判断 ${stats.undecided} 件、受容リスク ${stats.accepted} 件です。`,
		);
		lines.push(
			`- **Evidence confidence:** strong review ${strongReviewCount} 件、weak/missing decision-grade evidence ${weakOrMissingDecisionGradeEvidence} 件です。`,
		);
		lines.push(
			"- **Recommended focus:** high severity の修正対象、未判断 finding、証跡が弱い finding の順に triage を完了してください。",
		);
	}
	lines.push("");

	lines.push("## Evidence Quality Summary");
	if (processedFindings.length === 0) {
		lines.push(
			"finding がないため、finding 単位の evidence quality はありません。",
		);
	} else {
		lines.push(
			"| Finding ID | Source/tool evidence | Review strength | Verification | Decision |",
		);
		lines.push("| --- | --- | --- | --- | --- |");
		for (const item of sortedFindings) {
			const fndRepros = allReproRuns.filter(
				(r) => r.findingId === item.finding.id,
			);
			const fndDynamics = allDynamicRuns.filter(
				(r) => r.findingId === item.finding.id,
			);
			const fndDastEv = allDastEvidence.filter(
				(e) => e.findingId === item.finding.id,
			);
			const locationPath = getLocationPath(item.finding.primaryLocation);
			const sourceOrTool =
				locationPath || item.evidences.length > 0 ? "present" : "missing";
			const verification =
				fndRepros.length > 0 || fndDynamics.length > 0 || fndDastEv.length > 0
					? "present"
					: "missing";
			lines.push(
				`| ${item.finding.id} | ${sourceOrTool} | ${escapeTableCell(item.latestCompletedReview?.evidenceStrength?.level ?? "missing")} | ${verification} | ${escapeTableCell(item.latestDecision?.decision ?? "undecided")} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Remediation Plan");
	if (processedFindings.length === 0) {
		lines.push("修正計画が必要な finding はありません。");
	} else {
		lines.push(
			"| Finding ID | Status | Priority | Owner | Due date | Recommended fix |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		for (const item of sortedFindings) {
			const remediation = readRemediationMetadata(item.latestDecision);
			const locationPath = getLocationPath(item.finding.primaryLocation);
			const fallback = buildRemediationFallback({
				bucket: item.bucket,
				severity: item.finding.severity.toLowerCase(),
				locationPath,
			});
			lines.push(
				`| ${item.finding.id} | ${escapeTableCell(remediation.status ?? item.bucket)} | ${escapeTableCell(remediation.priority ?? "-")} | ${escapeTableCell(remediation.owner ?? "-")} | ${escapeTableCell(remediation.dueDate ?? "-")} | ${escapeTableCell(remediation.recommendedFix || item.latestCompletedReview?.remediationDirection || fallback)} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Scan Comparison Delta");
	lines.push(
		"この Markdown builder は単一 scan run の保存済みデータから生成されます。baseline scan が UI/API から提供されていない場合、改善・悪化の差分は partial として扱ってください。",
	);
	lines.push("");

	if (rawFindings.length === 0) {
		lines.push("## Zero-Finding Coverage Explanation");
		lines.push(
			"finding 0 件は、今回実行した tool/profile/scope で正規化 finding が出なかったことを示します。診断レポート、攻撃面 inventory、security check が不足している場合は安全性の証明ではありません。",
		);
		lines.push("");
	}

	// Tool Summary Table
	lines.push("## ツール実行サマリ");
	if (tools.length > 0) {
		const profile = getProfileById(scanRun.profile);
		const profileTools = profile?.tools ?? [];

		lines.push("| ツール | 種別 | バージョン | 状態 | 終了コード |");
		lines.push("| --- | --- | --- | --- | --- |");
		// Sort tools deterministically
		const sortedTools = [...tools].sort((a, b) => {
			const nameDiff = a.toolName.localeCompare(b.toolName);
			if (nameDiff !== 0) return nameDiff;
			const createdA = a.createdAt ? a.createdAt.getTime() : 0;
			const createdB = b.createdAt ? b.createdAt.getTime() : 0;
			if (createdA !== createdB) return createdA - createdB;
			return a.id.localeCompare(b.id);
		});
		for (const t of sortedTools) {
			const profileTool = profileTools.find((pt) => pt.toolId === t.toolName);
			const requiredText = profileTool
				? profileTool.required
					? "必須"
					: "任意"
				: "N/A";
			lines.push(
				`| ${escapeTableCell(t.toolName)} | ${escapeTableCell(requiredText)} | ${escapeTableCell(t.toolVersion || "unknown")} | ${escapeTableCell(t.status)} | ${escapeTableCell(t.exitCode ?? "-")} |`,
			);
		}
	} else {
		lines.push("このスキャンで実行されたツールはありません。");
	}
	lines.push("");

	// Decision Summary Table
	lines.push("## 判断サマリ");
	lines.push("| 判断 | 件数 |");
	lines.push("| --- | --- |");
	lines.push(`| 修正が必要 | ${stats.needs_fix} |`);
	lines.push(`| リスク受容 | ${stats.accepted} |`);
	lines.push(`| 対応保留 | ${stats.deferred} |`);
	lines.push(`| 誤検知 | ${stats.false_positive} |`);
	lines.push(`| 未判断 | ${stats.undecided} |`);
	lines.push(`| **合計** | ${rawFindings.length} |`);
	lines.push("");

	lines.push("## Severity サマリ");
	lines.push("| Severity | 件数 |");
	lines.push("| --- | --- |");
	lines.push(`| 緊急 | ${severityStats.critical} |`);
	lines.push(`| 高 | ${severityStats.high} |`);
	lines.push(`| 中 | ${severityStats.medium} |`);
	lines.push(`| 低 | ${severityStats.low} |`);
	lines.push(`| 情報 | ${severityStats.info} |`);
	lines.push(`| 不明 | ${severityStats.unknown} |`);
	lines.push("");

	// Render a group of findings helper
	const renderFindingsGroup = (
		groupTitle: string,
		list: typeof sortedFindings,
		isIncluded: boolean,
	) => {
		lines.push(`## ${groupTitle}`);
		if (!isIncluded) {
			lines.push("レポート設定により、このセクションは除外されています。");
			lines.push("");
			return;
		}
		if (list.length === 0) {
			lines.push("この分類の finding はありません。");
			lines.push("");
			return;
		}

		for (const item of list) {
			const f = item.finding;
			const locationPath = getLocationPath(f.primaryLocation);
			const startLine = getLocationStartLine(f.primaryLocation) || 1;
			const locationText = locationPath
				? `${locationPath}:${startLine}`
				: "なし";
			const fndRepros = allReproRuns.filter((r) => r.findingId === f.id);
			const fndDynamics = allDynamicRuns.filter((r) => r.findingId === f.id);
			const fndDastEv = allDastEvidence.filter((e) => e.findingId === f.id);
			const review = item.latestCompletedReview;
			const evidenceKinds = describeEvidenceKinds(item.evidences);
			const remediation =
				toInlineText(review?.remediationDirection, "") ||
				buildRemediationFallback({
					bucket: item.bucket,
					severity: f.severity.toLowerCase(),
					locationPath,
				});
			const impact =
				toInlineText(review?.likelyImpact, "") ||
				`${formatSeverity(f.severity)} severity の検出です。${toInlineText(f.description)}`;
			const verificationNotes: string[] = [];
			if (fndRepros.length > 0) {
				verificationNotes.push(`sandbox reproduction ${fndRepros.length}件`);
			}
			if (fndDynamics.length > 0) {
				verificationNotes.push(`dynamic verification ${fndDynamics.length}件`);
			}
			if (fndDastEv.length > 0) {
				verificationNotes.push(`DAST evidence ${fndDastEv.length}件`);
			}

			lines.push(`### Finding ${f.id}`);
			lines.push(`- **タイトル:** ${toInlineText(f.title)}`);
			lines.push(`- **説明:** ${toInlineText(f.description)}`);
			lines.push(`- **検出ツール:** ${toInlineText(f.sourceTool)}`);
			lines.push(`- **ルールID:** ${toInlineText(f.ruleId)}`);
			lines.push(
				`- **Severity:** ${formatSeverity(f.severity)} (${toInlineText(f.severity)})`,
			);
			lines.push(`- **判断:** ${formatDecision(item.bucket)}`);
			lines.push(
				`- **判断理由:** ${item.latestDecision ? toInlineText(item.latestDecision.reason) : "未判断のため未記録"}`,
			);
			if (item.latestDecision?.comment) {
				lines.push(
					`- **判断コメント:** ${toInlineText(item.latestDecision.comment)}`,
				);
			}
			lines.push(`- **主な場所:** ${toInlineText(locationText)}`);
			lines.push("");

			lines.push("#### 考察");
			lines.push(
				`- **判断の読み:** ${formatDecision(item.bucket)}として扱っています。${review ? "LLMレビュー結果と保存済み証跡をあわせて確認しています。" : "LLMレビューは未完了のため、現時点では静的検出と保存済み証跡が主な根拠です。"}`,
			);
			lines.push(`- **想定影響:** ${impact}`);
			lines.push(
				`- **根拠:** ${evidenceKinds}。主な場所は ${toInlineText(locationText)} です。`,
			);
			if (review?.falsePositiveAssessment) {
				lines.push(
					`- **誤検知の見立て:** ${FALSE_POSITIVE_LABELS[review.falsePositiveAssessment.level] ?? review.falsePositiveAssessment.level}。${toInlineText(review.falsePositiveAssessment.reasoning)}`,
				);
			}
			if (review?.evidenceStrength) {
				lines.push(
					`- **証跡の強さ:** ${EVIDENCE_STRENGTH_LABELS[review.evidenceStrength.level] ?? review.evidenceStrength.level}。${toInlineText(review.evidenceStrength.reasoning)}`,
				);
			}
			lines.push(`- **対応方針:** ${remediation}`);
			lines.push(
				`- **検証状況:** ${verificationNotes.length > 0 ? `${verificationNotes.join("、")} が記録されています。` : "再現・動的検証・DAST証跡はまだ記録されていません。"}`,
			);
			lines.push("");

			// Evidences
			lines.push("#### 証跡");
			if (item.evidences.length > 0) {
				for (const ev of item.evidences) {
					lines.push(`##### 証跡 ${ev.id}`);
					lines.push(`- **種別:** ${toInlineText(ev.kind)}`);
					lines.push(`- **タイトル:** ${toInlineText(ev.title)}`);
					if (ev.location) {
						lines.push(`- **場所:** ${JSON.stringify(ev.location)}`);
					}
					if (ev.artifactId) {
						lines.push(`- **アーティファクト参照:** ${ev.artifactId}`);
					}
					if (ev.snippet) {
						const fence = codeFenceFor(ev.snippet);
						lines.push("- **スニペット:**");
						lines.push(fence);
						lines.push(ev.snippet);
						lines.push(fence);
					}
					lines.push("");
				}
			} else {
				lines.push("証跡は記録されていません。");
				lines.push("");
			}

			// LLM Review
			lines.push("#### LLMレビュー");
			if (review) {
				const r = review;
				lines.push(`- **状態:** ${r.status}`);
				lines.push(`- **プロバイダー:** ${toInlineText(r.provider)}`);
				lines.push(`- **モデル:** ${toInlineText(r.model)}`);
				lines.push(`- **要約:** ${toInlineText(r.summary)}`);
				lines.push(`- **想定影響:** ${toInlineText(r.likelyImpact)}`);
				if (r.falsePositiveAssessment) {
					lines.push(
						`- **誤検知評価:** レベル: ${FALSE_POSITIVE_LABELS[r.falsePositiveAssessment.level] ?? toInlineText(r.falsePositiveAssessment.level)}, 理由: ${toInlineText(r.falsePositiveAssessment.reasoning)}`,
					);
				}
				if (r.evidenceStrength) {
					lines.push(
						`- **証跡強度:** レベル: ${EVIDENCE_STRENGTH_LABELS[r.evidenceStrength.level] ?? toInlineText(r.evidenceStrength.level)}, 理由: ${toInlineText(r.evidenceStrength.reasoning)}`,
					);
				}
				lines.push(`- **修正方向:** ${toInlineText(r.remediationDirection)}`);
				if (r.reviewerNotes && r.reviewerNotes.length > 0) {
					lines.push("- **レビューメモ:**");
					for (const note of r.reviewerNotes) {
						lines.push(`  - ${toInlineText(note)}`);
					}
				}
			} else {
				lines.push("- **状態:** 完了したレビューはありません。");
			}
			lines.push("");

			// Sandbox Reproduction
			lines.push("#### Sandbox Reproduction");
			if (fndRepros.length > 0) {
				for (const r of fndRepros) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **プロファイル:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **状態:** ${toInlineText(r.status)}`);
					lines.push(`  - **結果:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **要約:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **エラー:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("sandbox reproduction は記録されていません。");
			}
			lines.push("");

			// Dynamic Verification
			lines.push("#### Dynamic Verification");
			if (fndDynamics.length > 0) {
				for (const r of fndDynamics) {
					lines.push(`- **Run ID:** ${r.id}`);
					lines.push(`  - **プロファイル:** ${toInlineText(r.profileId)}`);
					lines.push(`  - **種別:** ${toInlineText(r.dynamicKind)}`);
					lines.push(`  - **状態:** ${toInlineText(r.status)}`);
					lines.push(`  - **結果:** ${toInlineText(r.outcome || "N/A")}`);
					if (r.summary) {
						lines.push(`  - **要約:** ${toInlineText(r.summary)}`);
					}
					if (r.errorMessage) {
						lines.push(`  - **エラー:** ${toInlineText(r.errorMessage)}`);
					}
				}
			} else {
				lines.push("dynamic verification は記録されていません。");
			}
			lines.push("");

			// DAST Evidence
			lines.push("#### DAST証跡");
			if (fndDastEv.length > 0) {
				for (const ev of fndDastEv) {
					lines.push(`- **証跡ID:** ${ev.id}`);
					lines.push(`  - **Run ID:** ${ev.dastRunId}`);
					lines.push(`  - **種別:** ${toInlineText(ev.kind)}`);
					lines.push(`  - **タイトル:** ${toInlineText(ev.title)}`);
					if (ev.snippet) {
						lines.push(`  - **スニペット:** ${toInlineText(ev.snippet)}`);
					}
				}
			} else {
				lines.push("DAST証跡は記録されていません。");
			}
			lines.push("");

			// Raw Artifact references for finding
			const uniqueArtifactIds = Array.from(
				new Set(item.evidences.map((e) => e.artifactId).filter(Boolean)),
			) as string[];
			if (uniqueArtifactIds.length > 0) {
				lines.push("#### Raw Artifact参照");
				// Sort artifact references deterministically: kind, format, id
				const fndArtifacts = allArtifacts
					.filter((a) => uniqueArtifactIds.includes(a.id))
					.sort((a, b) => {
						const kindDiff = a.kind.localeCompare(b.kind);
						if (kindDiff !== 0) return kindDiff;
						const formatDiff = a.format.localeCompare(b.format);
						if (formatDiff !== 0) return formatDiff;
						return a.id.localeCompare(b.id);
					});
				for (const a of fndArtifacts) {
					lines.push(`- ${a.id} (${a.kind}/${a.format}): ${a.path}`);
				}
				lines.push("");
			}
		}
	};

	// 4. Render main sections
	renderFindingsGroup("修正対象・リスク受容 Finding", activeFindings, true);
	renderFindingsGroup(
		"対応保留 Finding",
		deferredFindings,
		options.includeDeferred,
	);
	renderFindingsGroup(
		"誤検知 Finding",
		falsePositiveFindings,
		options.includeFalsePositives,
	);
	renderFindingsGroup(
		"未判断 Finding",
		undecidedFindings,
		options.includeUndecided,
	);

	// Sandbox Reproduction Summary Section
	lines.push("## Sandbox Reproduction サマリ");
	if (allReproRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | プロファイル | 状態 | 結果 | 終了コード |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- |");
		const sortedReproRuns = [...allReproRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedReproRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push(
			"このスキャンには sandbox reproduction run が記録されていません。",
		);
	}
	lines.push("");

	// Dynamic Verification Summary Section
	lines.push("## Dynamic Verification サマリ");
	if (allDynamicRuns.length > 0) {
		lines.push(
			"| Run ID | Finding ID | プロファイル | 種別 | 状態 | 結果 | 終了コード |",
		);
		lines.push("| --- | --- | --- | --- | --- | --- | --- |");
		const sortedDynRuns = [...allDynamicRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDynRuns) {
			lines.push(
				`| ${r.id} | ${r.findingId || "-"} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.dynamicKind)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} | ${r.exitCode ?? "-"} |`,
			);
		}
	} else {
		lines.push(
			"このスキャンには dynamic verification run が記録されていません。",
		);
	}
	lines.push("");

	// DAST Summary Section
	lines.push("## DAST サマリ");
	if (allDastRuns.length > 0) {
		lines.push("| Run ID | 対象Origin | プロファイル | 状態 | 結果 |");
		lines.push("| --- | --- | --- | --- | --- |");
		const sortedDastRuns = [...allDastRuns].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		for (const r of sortedDastRuns) {
			lines.push(
				`| ${r.id} | ${escapeTableCell(r.targetOrigin)} | ${escapeTableCell(r.profileId)} | ${escapeTableCell(r.status)} | ${escapeTableCell(r.outcome || "-")} |`,
			);
		}
	} else {
		lines.push("このスキャンには DAST run が記録されていません。");
	}
	lines.push("");

	// Verification Metadata Section
	lines.push("## 検証メタデータ");
	lines.push(
		`- **レポート生成基準日時:** ${formatDateTime(scanRun.completedAt || scanRun.startedAt || scanRun.createdAt)}`,
	);
	lines.push(`- **Scan Run ID:** ${scanRunId}`);
	lines.push(`- **Drizzle Schema Version:** Phase 12 Hardened`);
	lines.push("");

	// Appendix: Raw Artifact References
	lines.push("## 付録: Raw Artifact参照");
	if (allArtifacts.length > 0) {
		const sortedArtifacts = [...allArtifacts].sort((a, b) => {
			const kindDiff = a.kind.localeCompare(b.kind);
			if (kindDiff !== 0) return kindDiff;
			const formatDiff = a.format.localeCompare(b.format);
			if (formatDiff !== 0) return formatDiff;
			return a.id.localeCompare(b.id);
		});
		for (const a of sortedArtifacts) {
			lines.push(
				`- ID: ${a.id} (種別: ${a.kind}, 形式: ${a.format}, パス: ${a.path}, サイズ: ${a.sizeBytes} bytes, SHA256: ${a.sha256})`,
			);
		}
	} else {
		lines.push("このスキャンには artifact が記録されていません。");
	}
	lines.push("");

	// Appendix: Review References
	lines.push("## 付録: レビュー参照");
	// Sort reviews deterministically: findingId, status, id
	const sortedReviews = [...allReviews].sort((a, b) => {
		const findingDiff = a.findingId.localeCompare(b.findingId);
		if (findingDiff !== 0) return findingDiff;
		const statusDiff = a.status.localeCompare(b.status);
		if (statusDiff !== 0) return statusDiff;
		return a.id.localeCompare(b.id);
	});
	if (sortedReviews.length > 0) {
		for (const r of sortedReviews) {
			lines.push(
				`- Finding ID: ${r.findingId} (Review ID: ${r.id}, Provider: ${r.provider}, Model: ${r.model}, Status: ${r.status})`,
			);
		}
	} else {
		lines.push("このスキャンには LLMレビューが記録されていません。");
	}
	lines.push("");

	// Appendix: Finding Groups Snapshot
	lines.push("## 付録: Findingグループスナップショット");
	try {
		const { buildGroupedFindings } = await import("./grouping-builder");
		const grouped = await buildGroupedFindings(db, scanRunId);
		if (grouped.groups.length > 0) {
			lines.push(
				"| グループタイトル | 戦略 | Severity | 検出ツール | Finding件数 |",
			);
			lines.push("| --- | --- | --- | --- | --- |");
			for (const g of grouped.groups) {
				lines.push(
					`| ${escapeTableCell(g.title)} | ${escapeTableCell(g.metadata.strategy)} | ${escapeTableCell(g.severity)} | ${escapeTableCell(g.sourceTools.join(", "))} | ${g.findingIds.length} |`,
				);
			}
		} else {
			lines.push("finding グループは記録されていません。");
		}
	} catch (err) {
		lines.push(
			`finding グループの生成に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	lines.push("");

	return lines.join("\n");
}
