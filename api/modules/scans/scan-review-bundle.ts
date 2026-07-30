import { eq, inArray } from "drizzle-orm";
import type { ScanReviewFindingFilter } from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import {
	dastRuns,
	dynamicRuns,
	findingDecisions,
	findingEvidences,
	findingReviews,
	findings,
	projects,
	reproductionRuns,
	scanArtifacts,
	scanRuns,
	toolRuns,
} from "../../db/schema";
import {
	compactReviewEvidenceMetadata,
	compactReviewFindingMetadata,
} from "./scan-review-metadata";
import { compactToolProvenance } from "./scan-review-provenance";
import { buildScanRunSummary } from "./summary-builder";

export type ScanReviewBundleOptions = {
	maxFindings?: number;
	maxEvidencePerFinding?: number;
	maxSnippetChars?: number;
	maxDescriptionChars?: number;
	findingFilter?: ScanReviewFindingFilter;
};

export type ScanReviewBundle = Awaited<
	ReturnType<typeof buildScanReviewBundle>
>;

const DEFAULT_MAX_FINDINGS = 50;
const DEFAULT_MAX_EVIDENCE_PER_FINDING = 2;
const DEFAULT_MAX_SNIPPET_CHARS = 300;
const DEFAULT_MAX_DESCRIPTION_CHARS = 400;

function truncateText(value: string | null | undefined, maxChars: number) {
	if (!value) return null;
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n[truncated]`;
}

function locationPath(location: unknown): string {
	if (!location || typeof location !== "object") return "";
	const value = (location as Record<string, unknown>).path;
	return typeof value === "string" ? value : "";
}

function locationLine(location: unknown): number {
	if (!location || typeof location !== "object") return 0;
	const value = (location as Record<string, unknown>).startLine;
	return typeof value === "number"
		? value
		: typeof value === "string"
			? Number(value) || 0
			: 0;
}

function metadataDeltaKind(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const record = metadata as Record<string, unknown>;
	const value =
		record.deltaKind ?? record.comparisonKind ?? record.scanComparisonKind;
	return typeof value === "string" ? value : null;
}

function compactScanRunMetadata(metadata: unknown): Record<string, unknown> {
	if (!metadata || typeof metadata !== "object") return {};
	const source = metadata as Record<string, unknown>;
	const compact: Record<string, unknown> = {};
	for (const key of [
		"profileId",
		"profileVersion",
		"scope",
		"continueOnToolFailure",
		"runner",
		"executionPolicy",
		"profileOutcome",
	]) {
		if (source[key] !== undefined) compact[key] = source[key];
	}
	return compact;
}

type FindingRow = typeof findings.$inferSelect;
type ScanRunRow = typeof scanRuns.$inferSelect;
type CurrentDeltaKind = "new" | "unchanged" | "regressed";

const severityRank: Record<string, number> = {
	critical: 5,
	high: 4,
	medium: 3,
	low: 2,
	info: 1,
	unknown: 0,
};

function metadataStableId(finding: FindingRow): string {
	const metadata = finding.metadata ?? {};
	for (const key of ["stableId", "normalizedId", "dedupeKey"]) {
		const value = metadata[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

function comparisonKey(finding: FindingRow): string | null {
	const stable = metadataStableId(finding);
	if (stable) return `stable:${stable}`;
	const fingerprint = finding.fingerprint?.trim();
	if (fingerprint) return `fingerprint:${fingerprint}`;
	const location = locationPath(finding.primaryLocation);
	if (finding.sourceTool.trim() && finding.ruleId.trim() && location.trim()) {
		return ["rule_location", finding.sourceTool, finding.ruleId, location]
			.map((part) => part.trim().toLowerCase())
			.join("|");
	}
	return null;
}

function isRegressed(current: FindingRow, baseline: FindingRow): boolean {
	const severityRegressed =
		(severityRank[current.severity] ?? 0) >
		(severityRank[baseline.severity] ?? 0);
	const currentActive =
		!current.status ||
		current.status === "open" ||
		current.status === "needs_fix" ||
		current.status === "deferred";
	const baselineResolved =
		baseline.status === "accepted" || baseline.status === "false_positive";
	return severityRegressed || (baselineResolved && currentActive);
}

async function buildCurrentDeltaByFindingId(
	db: AppDatabase,
	scanRun: ScanRunRow,
	currentFindings: FindingRow[],
): Promise<Map<string, CurrentDeltaKind> | null> {
	const sameProjectRuns = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.projectId, scanRun.projectId));
	const baselineRun =
		sameProjectRuns
			.filter(
				(run) =>
					run.id !== scanRun.id &&
					run.profile === scanRun.profile &&
					run.createdAt.getTime() < scanRun.createdAt.getTime(),
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
	if (!baselineRun) return null;

	const baselineFindings = await db
		.select()
		.from(findings)
		.where(eq(findings.scanRunId, baselineRun.id));
	const baselineByKey = new Map<string, FindingRow>();
	for (const finding of baselineFindings) {
		const key = comparisonKey(finding);
		if (key) baselineByKey.set(key, finding);
	}

	const deltaByFindingId = new Map<string, CurrentDeltaKind>();
	for (const current of currentFindings) {
		const key = comparisonKey(current);
		const baseline = key ? baselineByKey.get(key) : undefined;
		if (!baseline) {
			deltaByFindingId.set(current.id, "new");
			continue;
		}
		deltaByFindingId.set(
			current.id,
			isRegressed(current, baseline) ? "regressed" : "unchanged",
		);
	}
	return deltaByFindingId;
}

export async function buildScanReviewBundle(
	db: AppDatabase,
	scanRunId: string,
	options: ScanReviewBundleOptions = {},
) {
	const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
	const maxEvidencePerFinding =
		options.maxEvidencePerFinding ?? DEFAULT_MAX_EVIDENCE_PER_FINDING;
	const maxSnippetChars = options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS;
	const maxDescriptionChars =
		options.maxDescriptionChars ?? DEFAULT_MAX_DESCRIPTION_CHARS;
	const findingFilter = options.findingFilter ?? "all";
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId));
	if (!scanRun) throw new Error(`Scan run not found: ${scanRunId}`);
	const [project] = await db
		.select()
		.from(projects)
		.where(eq(projects.id, scanRun.projectId));
	if (!project) throw new Error(`Project not found: ${scanRun.projectId}`);

	const [
		summary,
		toolRows,
		artifactRows,
		findingRows,
		reproRows,
		dynamicRows,
		dastRows,
	] = await Promise.all([
		buildScanRunSummary(db, scanRunId),
		db.select().from(toolRuns).where(eq(toolRuns.scanRunId, scanRunId)),
		db
			.select()
			.from(scanArtifacts)
			.where(eq(scanArtifacts.scanRunId, scanRunId)),
		db.select().from(findings).where(eq(findings.scanRunId, scanRunId)),
		db
			.select()
			.from(reproductionRuns)
			.where(eq(reproductionRuns.scanRunId, scanRunId)),
		db.select().from(dynamicRuns).where(eq(dynamicRuns.scanRunId, scanRunId)),
		db.select().from(dastRuns).where(eq(dastRuns.scanRunId, scanRunId)),
	]);

	const sortedAllFindings = [...findingRows].sort((a, b) => {
		const severityOrder = ["critical", "high", "medium", "low", "info"];
		const severityDiff =
			severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity);
		if (severityDiff !== 0) return severityDiff;
		const pathDiff = locationPath(a.primaryLocation).localeCompare(
			locationPath(b.primaryLocation),
		);
		if (pathDiff !== 0) return pathDiff;
		const lineDiff =
			locationLine(a.primaryLocation) - locationLine(b.primaryLocation);
		if (lineDiff !== 0) return lineDiff;
		return a.id.localeCompare(b.id);
	});
	const allFindingIds = sortedAllFindings.map((finding) => finding.id);
	const [allEvidenceRows, allReviewRows, allDecisionRows] =
		allFindingIds.length > 0
			? await Promise.all([
					db
						.select()
						.from(findingEvidences)
						.where(inArray(findingEvidences.findingId, allFindingIds)),
					db
						.select()
						.from(findingReviews)
						.where(inArray(findingReviews.findingId, allFindingIds)),
					db
						.select()
						.from(findingDecisions)
						.where(inArray(findingDecisions.findingId, allFindingIds)),
				])
			: [[], [], []];

	const latestCompletedReview = (findingId: string) =>
		allReviewRows
			.filter(
				(review) =>
					review.findingId === findingId && review.status === "completed",
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

	const currentDeltaByFindingId =
		findingFilter === "new_or_regressed"
			? await buildCurrentDeltaByFindingId(db, scanRun, sortedAllFindings)
			: null;
	if (
		findingFilter === "new_or_regressed" &&
		sortedAllFindings.length > 0 &&
		!currentDeltaByFindingId &&
		sortedAllFindings.every((finding) => !metadataDeltaKind(finding.metadata))
	) {
		throw new Error(
			"new_or_regressed filter requires a previous same-profile scan or comparison metadata.",
		);
	}

	const filteredFindings = sortedAllFindings.filter((finding) => {
		if (findingFilter === "all") return true;
		if (findingFilter === "high_or_critical") {
			return finding.severity === "high" || finding.severity === "critical";
		}
		if (findingFilter === "weak_or_missing_evidence") {
			const evidenceCount = allEvidenceRows.filter(
				(evidence) => evidence.findingId === finding.id,
			).length;
			const review = latestCompletedReview(finding.id);
			return (
				evidenceCount === 0 ||
				!review?.evidenceStrength ||
				review.evidenceStrength.level === "weak" ||
				review.evidenceStrength.level === "unknown"
			);
		}
		const deltaKind =
			metadataDeltaKind(finding.metadata) ??
			currentDeltaByFindingId?.get(finding.id);
		return deltaKind === "new" || deltaKind === "regressed";
	});
	const sortedFindings = filteredFindings.slice(0, maxFindings);
	const findingIds = sortedFindings.map((finding) => finding.id);
	const evidenceRows = allEvidenceRows.filter((evidence) =>
		findingIds.includes(evidence.findingId),
	);
	const decisionRows = allDecisionRows.filter((decision) =>
		findingIds.includes(decision.findingId),
	);

	const latestDecision = (findingId: string) =>
		decisionRows
			.filter((decision) => decision.findingId === findingId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

	const scannerArtifactRows = artifactRows.filter(
		(artifact) => artifact.kind !== "report",
	);
	const compactSummaryTools = summary.tools.map((tool) => {
		const compact = { ...tool } as Record<string, unknown>;
		delete compact.metadata;
		compact.artifactCount = tool.toolRunId
			? scannerArtifactRows.filter(
					(artifact) => artifact.toolRunId === tool.toolRunId,
				).length
			: 0;
		return compact;
	});
	const artifactCountByToolId = new Map(
		compactSummaryTools.map((tool) => [
			typeof tool.toolId === "string" ? tool.toolId : "",
			typeof tool.artifactCount === "number" ? tool.artifactCount : 0,
		]),
	);
	const compactSummary = {
		...summary,
		totals: {
			...summary.totals,
			artifactCount: scannerArtifactRows.length,
		},
		tools: compactSummaryTools,
		steps: (summary.steps ?? []).map((step) => {
			const compact = { ...step } as Record<string, unknown>;
			delete compact.metadata;
			if (step.kind === "static_tool") {
				compact.artifactCount = artifactCountByToolId.get(step.id) ?? 0;
			}
			return compact;
		}),
	};

	return {
		scanRun: {
			id: scanRun.id,
			projectId: scanRun.projectId,
			profile: scanRun.profile,
			status: scanRun.status,
			summary: scanRun.summary,
			metadata: compactScanRunMetadata(scanRun.metadata),
			startedAt: scanRun.startedAt,
			completedAt: scanRun.completedAt,
		},
		project: {
			id: project.id,
			name: project.name,
			defaultBranch: project.defaultBranch,
		},
		summary: compactSummary,
		tools: toolRows.map((tool) => ({
			id: tool.id,
			toolName: tool.toolName,
			toolVersion: tool.toolVersion,
			status: tool.status,
			exitCode: tool.exitCode,
			provenance: compactToolProvenance(tool.metadata),
			startedAt: tool.startedAt,
			completedAt: tool.completedAt,
		})),
		artifacts: scannerArtifactRows.map((artifact) => ({
			id: artifact.id,
			toolRunId: artifact.toolRunId,
			kind: artifact.kind,
			format: artifact.format,
			sha256: artifact.sha256,
			sizeBytes: artifact.sizeBytes,
		})),
		findings: sortedFindings.map((finding) => {
			const review = latestCompletedReview(finding.id);
			const decision = latestDecision(finding.id);
			return {
				id: finding.id,
				sourceTool: finding.sourceTool,
				ruleId: finding.ruleId,
				title: finding.title,
				description: truncateText(finding.description, maxDescriptionChars),
				severity: finding.severity,
				confidence: finding.confidence,
				status: finding.status,
				primaryLocation: finding.primaryLocation,
				metadata: compactReviewFindingMetadata(finding.metadata),
				evidence: evidenceRows
					.filter((evidence) => evidence.findingId === finding.id)
					.slice(0, maxEvidencePerFinding)
					.map((evidence) => ({
						id: evidence.id,
						kind: evidence.kind,
						title: evidence.title,
						location: evidence.location,
						snippet: truncateText(evidence.snippet, maxSnippetChars),
						artifactId: evidence.artifactId,
						metadata: compactReviewEvidenceMetadata(evidence.metadata),
					})),
				latestReview: review
					? {
							id: review.id,
							summary: review.summary,
							likelyImpact: review.likelyImpact,
							evidenceStrength: review.evidenceStrength,
							falsePositiveAssessment: review.falsePositiveAssessment,
							confidenceAdjustment: review.confidenceAdjustment,
						}
					: null,
				latestDecision: decision
					? {
							id: decision.id,
							decision: decision.decision,
							reason: decision.reason,
							comment: decision.comment,
						}
					: null,
			};
		}),
		verification: {
			reproductions: reproRows.map((row) => ({
				id: row.id,
				findingId: row.findingId,
				status: row.status,
				outcome: row.outcome,
				errorMessage: row.errorMessage,
			})),
			dynamicRuns: dynamicRows.map((row) => ({
				id: row.id,
				findingId: row.findingId,
				status: row.status,
				outcome: row.outcome,
				errorMessage: row.errorMessage,
			})),
			dastRuns: dastRows.map((row) => ({
				id: row.id,
				targetConfigId: row.targetConfigId,
				profileId: row.profileId,
				status: row.status,
				outcome: row.outcome,
				summary: row.summary,
				errorMessage: row.errorMessage,
			})),
		},
		limits: {
			totalFindings: findingRows.length,
			includedFindings: sortedFindings.length,
			maxFindings,
			maxEvidencePerFinding,
			maxSnippetChars,
			maxDescriptionChars,
			findingFilter,
		},
	};
}
