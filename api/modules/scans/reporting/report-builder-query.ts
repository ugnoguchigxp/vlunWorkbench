import { desc, eq, inArray } from "drizzle-orm";
import { automatedScanReviewOutputSchema } from "../../../../shared/schemas/automated-diagnostic.schema";
import type { AppDatabase } from "../../../db";
import {
	applicationModelSnapshots,
	attackSurfaceItems,
	businessLogicRuns,
	dastEvidence,
	dastRuns,
	diagnosticReports,
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
	securityCapabilityBenchmarkMetrics,
	securityCapabilityBenchmarkRuns,
	securityCheckResults,
	threatHypotheses,
	threatModelRuns,
	toolRuns,
} from "../../../db/schema";
import { ensureScanCoverageResults } from "../../assessments/coverage-builder";
import { getProfileById } from "../profiles";
import { readStoredResolvedProfile } from "../resolved-profile";
import type { ReportBuilderOptions } from "./report-builder-helpers";
import {
	getBucketRank,
	getLocationPath,
	getLocationStartLine,
	getSeverityRank,
	isKnownSeverity,
	readImprovementRequest,
	toInlineText,
} from "./report-builder-helpers";

export async function buildReportQuery(
	db: AppDatabase,
	scanRunId: string,
	options: ReportBuilderOptions,
) {
	// 1. Fetch main entities
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, scanRunId));
	if (!scanRun) {
		throw new Error(`Scan run not found: ${scanRunId}`);
	}
	const coverageResults = await ensureScanCoverageResults(db, scanRunId);

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
	allDastEvidence = await db
		.select()
		.from(dastEvidence)
		.where(eq(dastEvidence.scanRunId, scanRunId));
	const allAttackSurfaceItems = await db
		.select()
		.from(attackSurfaceItems)
		.where(eq(attackSurfaceItems.scanRunId, scanRunId));
	const allSecurityCheckResults = await db
		.select()
		.from(securityCheckResults)
		.where(eq(securityCheckResults.scanRunId, scanRunId));
	const allDiagnosticReports = await db
		.select()
		.from(diagnosticReports)
		.where(eq(diagnosticReports.scanRunId, scanRunId));
	const scanBusinessLogicRuns = await db
		.select()
		.from(businessLogicRuns)
		.where(eq(businessLogicRuns.scanRunId, scanRunId));
	const [latestApplicationModel] = await db
		.select()
		.from(applicationModelSnapshots)
		.where(eq(applicationModelSnapshots.projectId, scanRun.projectId))
		.orderBy(desc(applicationModelSnapshots.createdAt))
		.limit(1);
	const [latestThreatModelRun] = await db
		.select()
		.from(threatModelRuns)
		.where(eq(threatModelRuns.projectId, scanRun.projectId))
		.orderBy(desc(threatModelRuns.createdAt))
		.limit(1);
	const latestThreatHypotheses = latestThreatModelRun
		? await db
				.select()
				.from(threatHypotheses)
				.where(eq(threatHypotheses.runId, latestThreatModelRun.id))
		: [];
	const [latestBenchmarkRun] = await db
		.select()
		.from(securityCapabilityBenchmarkRuns)
		.orderBy(desc(securityCapabilityBenchmarkRuns.createdAt))
		.limit(1);
	const latestBenchmarkMetrics = latestBenchmarkRun
		? await db
				.select()
				.from(securityCapabilityBenchmarkMetrics)
				.where(
					eq(securityCapabilityBenchmarkMetrics.runId, latestBenchmarkRun.id),
				)
		: [];
	const allScanReviews = await db
		.select()
		.from(scanReviews)
		.where(eq(scanReviews.scanRunId, scanRunId));
	const completedScanReviews = allScanReviews
		.filter((review) => review.status === "completed")
		.sort((a, b) => {
			const timeA = a.createdAt ? a.createdAt.getTime() : 0;
			const timeB = b.createdAt ? b.createdAt.getTime() : 0;
			if (timeB !== timeA) return timeB - timeA;
			return b.id.localeCompare(a.id);
		});
	const latestAutomatedReview =
		completedScanReviews
			.map((review) => {
				const parsed = automatedScanReviewOutputSchema.safeParse(review.output);
				return parsed.success ? { review, output: parsed.data } : null;
			})
			.find((review) => review !== null) ?? null;
	const latestImprovementRequest =
		completedScanReviews
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
	const includedFindings = sortedFindings.filter((finding) => {
		if (finding.bucket === "needs_fix" || finding.bucket === "accepted") {
			return true;
		}
		if (finding.bucket === "deferred") return options.includeDeferred;
		if (finding.bucket === "false_positive")
			return options.includeFalsePositives;
		if (finding.bucket === "undecided") return options.includeUndecided;
		return false;
	});
	const profileDefinition =
		readStoredResolvedProfile(scanRun.metadata, scanRun.profile) ??
		getProfileById(scanRun.profile);
	const profileSteps = profileDefinition?.steps ?? [];
	const stepResults = Array.isArray(scanRun.metadata?.stepResults)
		? (scanRun.metadata.stepResults as Array<Record<string, unknown>>)
		: [];
	const expectedDastSteps = profileSteps.filter((step) => step.kind === "dast");
	const failedOrMissingDastSteps = expectedDastSteps.filter((step) => {
		const result = stepResults.find(
			(item) => item.kind === "dast" && item.profileId === step.profileId,
		);
		if (!result) return true;
		return result.status !== "completed";
	});

	const reportTitle = toInlineText(options.title, "セキュリティレポート");
	return {
		activeFindings,
		allArtifacts,
		allAttackSurfaceItems,
		allDastEvidence,
		allDastRuns,
		allDiagnosticReports,
		allDynamicRuns,
		allReproRuns,
		allReviews,
		allSecurityCheckResults,
		coverageResults,
		decidedFindingCount,
		deferredFindings,
		expectedDastSteps,
		failedOrMissingDastSteps,
		falsePositiveFindings,
		includedFindings,
		latestAutomatedReview,
		latestApplicationModel: latestApplicationModel ?? null,
		latestBenchmarkMetrics,
		latestBenchmarkRun: latestBenchmarkRun ?? null,
		latestImprovementRequest,
		latestThreatHypotheses,
		latestThreatModelRun: latestThreatModelRun ?? null,
		processedFindings,
		profileDefinition,
		profileSteps,
		project,
		rawFindings,
		reportTitle,
		reviewedFindingCount,
		scanRun,
		scanBusinessLogicRuns,
		severityStats,
		sortedFindings,
		stats,
		stepResults,
		tools,
		undecidedFindings,
	};
}
