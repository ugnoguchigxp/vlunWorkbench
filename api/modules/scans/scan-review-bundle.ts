import { eq, inArray } from "drizzle-orm";
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
import { buildScanRunSummary } from "./summary-builder";

export type ScanReviewBundleOptions = {
	maxFindings?: number;
	maxEvidencePerFinding?: number;
	maxSnippetChars?: number;
};

export type ScanReviewBundle = Awaited<
	ReturnType<typeof buildScanReviewBundle>
>;

const DEFAULT_MAX_FINDINGS = 50;
const DEFAULT_MAX_EVIDENCE_PER_FINDING = 5;
const DEFAULT_MAX_SNIPPET_CHARS = 1200;

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

export async function buildScanReviewBundle(
	db: AppDatabase,
	scanRunId: string,
	options: ScanReviewBundleOptions = {},
) {
	const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
	const maxEvidencePerFinding =
		options.maxEvidencePerFinding ?? DEFAULT_MAX_EVIDENCE_PER_FINDING;
	const maxSnippetChars = options.maxSnippetChars ?? DEFAULT_MAX_SNIPPET_CHARS;
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

	const sortedFindings = [...findingRows]
		.sort((a, b) => {
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
		})
		.slice(0, maxFindings);
	const findingIds = sortedFindings.map((finding) => finding.id);

	const [evidenceRows, reviewRows, decisionRows] =
		findingIds.length > 0
			? await Promise.all([
					db
						.select()
						.from(findingEvidences)
						.where(inArray(findingEvidences.findingId, findingIds)),
					db
						.select()
						.from(findingReviews)
						.where(inArray(findingReviews.findingId, findingIds)),
					db
						.select()
						.from(findingDecisions)
						.where(inArray(findingDecisions.findingId, findingIds)),
				])
			: [[], [], []];

	const latestCompletedReview = (findingId: string) =>
		reviewRows
			.filter(
				(review) =>
					review.findingId === findingId && review.status === "completed",
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

	const latestDecision = (findingId: string) =>
		decisionRows
			.filter((decision) => decision.findingId === findingId)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

	return {
		scanRun: {
			id: scanRun.id,
			projectId: scanRun.projectId,
			profile: scanRun.profile,
			status: scanRun.status,
			summary: scanRun.summary,
			metadata: scanRun.metadata,
			startedAt: scanRun.startedAt,
			completedAt: scanRun.completedAt,
		},
		project: {
			id: project.id,
			name: project.name,
			defaultBranch: project.defaultBranch,
		},
		summary,
		tools: toolRows.map((tool) => ({
			id: tool.id,
			toolName: tool.toolName,
			toolVersion: tool.toolVersion,
			status: tool.status,
			exitCode: tool.exitCode,
			startedAt: tool.startedAt,
			completedAt: tool.completedAt,
		})),
		artifacts: artifactRows.map((artifact) => ({
			id: artifact.id,
			kind: artifact.kind,
			format: artifact.format,
			sizeBytes: artifact.sizeBytes,
			metadata: artifact.metadata,
		})),
		findings: sortedFindings.map((finding) => {
			const review = latestCompletedReview(finding.id);
			const decision = latestDecision(finding.id);
			return {
				id: finding.id,
				sourceTool: finding.sourceTool,
				ruleId: finding.ruleId,
				title: finding.title,
				description: finding.description,
				severity: finding.severity,
				confidence: finding.confidence,
				status: finding.status,
				primaryLocation: finding.primaryLocation,
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
		},
	};
}
