import { createHash } from "node:crypto";
import type {
	StaticIntelligenceEmbeddingSource,
	StaticIntelligenceEmbeddingSourceMetadata,
	StaticIntelligenceEmbeddingSourceKind,
} from "../../../shared/schemas/static-intelligence-search.schema";
import type { StaticIntelligenceExportV1 } from "../../../shared/schemas/static-intelligence.schema";
import { scanReviewOutputSchema } from "../../../shared/schemas/scan.schema";
import {
	extractFindingPath,
	groupEvidenceByFindingId,
	normalizeStaticIntelligencePath,
} from "./file-risk-index";
import type {
	StaticIntelligenceEvidenceRow,
	StaticIntelligenceFindingRow,
	StaticIntelligenceSourceBundle,
} from "./types";

export function buildStaticIntelligenceEmbeddingSources(
	exportPayload: StaticIntelligenceExportV1,
	bundle: StaticIntelligenceSourceBundle,
): StaticIntelligenceEmbeddingSource[] {
	const evidenceByFindingId = groupEvidenceByFindingId(bundle.evidences);
	const sources: StaticIntelligenceEmbeddingSource[] = [
		...bundle.findings.map((finding) =>
			buildFindingSource(exportPayload, finding, evidenceByFindingId),
		),
		...bundle.evidences.map((evidence) =>
			buildEvidenceSource(exportPayload, evidence),
		),
		...exportPayload.fileRiskIndex.map((entry) =>
			buildFileRiskSummarySource(exportPayload, entry),
		),
	];

	if (bundle.latestCompletedReview) {
		sources.push(buildScanReviewSource(exportPayload, bundle));
		const improvementRequestSource = buildImprovementRequestSource(
			exportPayload,
			bundle,
		);
		if (improvementRequestSource) sources.push(improvementRequestSource);
	}

	return sources
		.map((source) => ({
			...source,
			contentHash: contentHash(
				source.sourceKind,
				source.sourceId,
				source.content,
			),
		}))
		.sort((a, b) => {
			const kindDiff = a.sourceKind.localeCompare(b.sourceKind);
			if (kindDiff !== 0) return kindDiff;
			return a.sourceRef.localeCompare(b.sourceRef);
		});
}

function buildFindingSource(
	exportPayload: StaticIntelligenceExportV1,
	finding: StaticIntelligenceFindingRow,
	evidenceByFindingId: Map<string, StaticIntelligenceEvidenceRow[]>,
): StaticIntelligenceEmbeddingSource {
	const evidences = evidenceByFindingId.get(finding.id) ?? [];
	const filePath = extractFindingPath(finding, evidences);
	return buildSource({
		exportPayload,
		sourceKind: "finding",
		sourceId: finding.id,
		sourceRef: `finding:${finding.id}`,
		title: finding.title,
		contentLines: [
			`Title: ${finding.title}`,
			`Description: ${finding.description}`,
			`Source tool: ${finding.sourceTool}`,
			`Rule id: ${finding.ruleId}`,
			`Severity: ${finding.severity}`,
			`File path: ${filePath}`,
		],
		metadata: {
			findingIds: [finding.id],
			evidenceRefs: evidences.map((evidence) => evidence.id),
			artifactRefs: sortedUnique(
				evidences
					.map((evidence) => evidence.artifactId)
					.filter((artifactId): artifactId is string => Boolean(artifactId)),
			),
			filePath,
			severity: finding.severity,
			ruleId: finding.ruleId,
			scanner: finding.sourceTool,
			candidateOnly: true,
		},
	});
}

function buildEvidenceSource(
	exportPayload: StaticIntelligenceExportV1,
	evidence: StaticIntelligenceEvidenceRow,
): StaticIntelligenceEmbeddingSource {
	const filePath = pathFromRecord(evidence.location);
	return buildSource({
		exportPayload,
		sourceKind: "evidence",
		sourceId: evidence.id,
		sourceRef: `evidence:${evidence.id}`,
		title: evidence.title,
		contentLines: [
			`Title: ${evidence.title}`,
			`Kind: ${evidence.kind}`,
			`Finding id: ${evidence.findingId}`,
			...(filePath ? [`File path: ${filePath}`] : []),
		],
		metadata: {
			findingIds: [evidence.findingId],
			evidenceRefs: [evidence.id],
			artifactRefs: evidence.artifactId ? [evidence.artifactId] : [],
			...(filePath ? { filePath } : {}),
			candidateOnly: true,
		},
	});
}

function buildFileRiskSummarySource(
	exportPayload: StaticIntelligenceExportV1,
	entry: StaticIntelligenceExportV1["fileRiskIndex"][number],
): StaticIntelligenceEmbeddingSource {
	const degradedReasons = entry.path === "unknown" ? ["unknown file path"] : [];
	return buildSource({
		exportPayload,
		sourceKind: "file_risk_summary",
		sourceId: entry.path,
		sourceRef: `file:${entry.path}`,
		title: `File risk: ${entry.path}`,
		contentLines: [
			`Path: ${entry.path}`,
			`Finding count: ${entry.findingCount}`,
			`Max severity: ${entry.maxSeverity}`,
			`Evidence quality: ${entry.evidenceQuality}`,
			`Scanners: ${entry.scanners.join(", ")}`,
			`Rule ids: ${entry.ruleIds.join(", ")}`,
		],
		metadata: {
			findingIds: entry.findingIds,
			evidenceRefs: entry.evidenceRefs,
			artifactRefs: entry.artifactRefs,
			filePath: entry.path,
			severity: entry.maxSeverity,
			degradedReasons,
			candidateOnly: true,
		},
	});
}

function buildScanReviewSource(
	exportPayload: StaticIntelligenceExportV1,
	bundle: StaticIntelligenceSourceBundle,
): StaticIntelligenceEmbeddingSource {
	const review = bundle.latestCompletedReview;
	if (!review) throw new Error("Completed scan review is required.");
	return buildSource({
		exportPayload,
		sourceKind: "scan_review",
		sourceId: review.id,
		sourceRef: `scan_review:${review.id}`,
		title: review.summary ?? "Scan review",
		contentLines: [
			`Title: ${review.summary ?? "Scan review"}`,
			...(review.summary ? [`Summary: ${review.summary}`] : []),
			...(review.riskOverview ? [`Risk overview: ${review.riskOverview}`] : []),
			...review.coverageNotes.map((note) => `Coverage note: ${note}`),
			...review.priorityNotes.map((note) => `Priority note: ${note}`),
			...review.recommendedNextActions.map(
				(action) => `Next action: ${action}`,
			),
		],
		metadata: {
			candidateOnly: true,
		},
	});
}

function buildImprovementRequestSource(
	exportPayload: StaticIntelligenceExportV1,
	bundle: StaticIntelligenceSourceBundle,
): StaticIntelligenceEmbeddingSource | null {
	const review = bundle.latestCompletedReview;
	if (!review || !exportPayload.handoff) return null;
	const parsed = scanReviewOutputSchema.safeParse(review.output);
	const request = parsed.success ? parsed.data.improvementRequest : null;
	const handoff = exportPayload.handoff;
	return buildSource({
		exportPayload,
		sourceKind: "improvement_request",
		sourceId: review.id,
		sourceRef: `improvement_request:${review.id}`,
		title: handoff.title,
		contentLines: [
			`Title: ${handoff.title}`,
			`Objective: ${handoff.objective}`,
			...handoff.acceptanceCriteria.map((item) => `Acceptance: ${item}`),
			...handoff.verificationCommands.map((command) => `Verify: ${command}`),
			...handoff.constraints.map((constraint) => `Constraint: ${constraint}`),
			...handoff.nonGoals.map((nonGoal) => `Non-goal: ${nonGoal}`),
		],
		metadata: {
			findingIds: sortedUnique(
				request?.priorityPlan.flatMap((item) => item.findingIds) ?? [],
			),
			evidenceRefs: sortedUnique(
				request?.implementationTasks.flatMap((item) => item.evidenceRefs) ?? [],
			),
			candidateOnly: true,
		},
	});
}

function buildSource(params: {
	exportPayload: StaticIntelligenceExportV1;
	sourceKind: StaticIntelligenceEmbeddingSourceKind;
	sourceId: string;
	sourceRef: string;
	title: string;
	contentLines: string[];
	metadata: StaticIntelligenceEmbeddingSourceMetadata;
}): StaticIntelligenceEmbeddingSource {
	const content = params.contentLines
		.map((line) => line.trim())
		.filter(Boolean)
		.join("\n");
	return {
		projectId: params.exportPayload.project.id,
		scanRunId: params.exportPayload.scan.id,
		sourceKind: params.sourceKind,
		sourceId: params.sourceId,
		sourceRef: params.sourceRef,
		title: params.title,
		content,
		contentHash: contentHash(params.sourceKind, params.sourceId, content),
		metadata: params.metadata,
	};
}

function contentHash(
	sourceKind: StaticIntelligenceEmbeddingSourceKind,
	sourceId: string,
	content: string,
): string {
	return createHash("sha256")
		.update(`${sourceKind}\n${sourceId}\n${content}`)
		.digest("hex");
}

function pathFromRecord(value: Record<string, unknown> | null): string | null {
	if (!value) return null;
	return normalizeStaticIntelligencePath(value.path ?? value.file);
}

function sortedUnique(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim()))].sort((a, b) =>
		a.localeCompare(b),
	);
}
