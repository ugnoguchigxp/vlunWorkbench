import { createHash } from "node:crypto";
import fs from "node:fs";
import type {
	StaticIntelligenceEvidenceQuality,
	StaticIntelligenceExportV1,
	StaticIntelligenceHandoff,
	StaticIntelligenceRiskBand,
	StaticIntelligenceSeverity,
} from "../../../shared/schemas/static-intelligence.schema";
import { staticIntelligenceExportV1Schema } from "../../../shared/schemas/static-intelligence.schema";
import type { CodeStructureSnapshot } from "../../../shared/schemas/static-intelligence-code-structure.schema";
import { scanReviewOutputSchema } from "../../../shared/schemas/scan.schema";
import type { AppDatabase } from "../../db";
import { buildCodeStructureExportEnrichment } from "./code-structure/export-enrichment";
import { buildDiagnosticEvidenceGraph } from "./evidence-graph";
import {
	buildFileRiskIndex,
	compareSeverity,
	normalizeSeverity,
} from "./file-risk-index";
import { StaticIntelligenceRepository } from "./repository";
import type { StaticIntelligenceSourceBundle } from "./types";

export class StaticIntelligenceScanRunNotFoundError extends Error {
	constructor(scanRunId: string) {
		super(`Scan run not found: ${scanRunId}`);
		this.name = "StaticIntelligenceScanRunNotFoundError";
	}
}

export class StaticIntelligenceCodeStructureSnapshotMismatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StaticIntelligenceCodeStructureSnapshotMismatchError";
	}
}

export type StaticIntelligenceExportOptions = {
	generatedAt?: Date;
	codeStructureSnapshot?: CodeStructureSnapshot;
};

export async function buildStaticIntelligenceExport(
	db: AppDatabase,
	scanRunId: string,
	options: StaticIntelligenceExportOptions = {},
): Promise<StaticIntelligenceExportV1> {
	const repository = new StaticIntelligenceRepository(db);
	const bundle = await repository.loadSourceBundle(scanRunId);
	if (!bundle) throw new StaticIntelligenceScanRunNotFoundError(scanRunId);
	return buildStaticIntelligenceExportFromBundle(bundle, options);
}

export function buildStaticIntelligenceExportFromBundle(
	bundle: StaticIntelligenceSourceBundle,
	options: StaticIntelligenceExportOptions = {},
): StaticIntelligenceExportV1 {
	validateCodeStructureSnapshotForProject(
		options.codeStructureSnapshot,
		bundle,
	);
	const degradedReasons: string[] = [];
	const handoff = extractHandoff(bundle, degradedReasons);
	const fileRiskIndex = buildFileRiskIndex(bundle);
	const graph = buildDiagnosticEvidenceGraph(bundle, { handoff });

	const exportPayload: StaticIntelligenceExportV1 = {
		version: "v1",
		generatedAt: (options.generatedAt ?? new Date()).toISOString(),
		project: {
			id: bundle.project.id,
			name: bundle.project.name,
		},
		scan: {
			id: bundle.scanRun.id,
			profile: bundle.scanRun.profile,
			status: bundle.scanRun.status,
			startedAt: dateToString(bundle.scanRun.startedAt),
			completedAt: dateToString(bundle.scanRun.completedAt),
			findingCount: bundle.findings.length,
			toolRunCount: bundle.toolRuns.length,
			artifactCount: bundle.artifacts.length,
			reviewStatus: scanReviewStatus(bundle),
		},
		scanSummary: {
			riskBand: computeRiskBand(bundle),
			evidenceQuality: computeScanEvidenceQuality(
				bundle.findings.length,
				fileRiskIndex.map((entry) => entry.evidenceQuality),
			),
			degradedReasons,
		},
		fileRiskIndex,
		graph,
		...(handoff ? { handoff } : {}),
		...(options.codeStructureSnapshot
			? {
					codeStructure: buildCodeStructureExportEnrichment(
						options.codeStructureSnapshot,
					),
				}
			: {}),
	};

	return staticIntelligenceExportV1Schema.parse(exportPayload);
}

function validateCodeStructureSnapshotForProject(
	snapshot: CodeStructureSnapshot | undefined,
	bundle: StaticIntelligenceSourceBundle,
): void {
	if (!snapshot) return;
	if (snapshot.project.id && snapshot.project.id !== bundle.project.id) {
		throw new StaticIntelligenceCodeStructureSnapshotMismatchError(
			"Code structure snapshot project id does not match scan project.",
		);
	}
	let realProjectPath: string;
	try {
		realProjectPath = fs.realpathSync(bundle.project.repoPath);
	} catch {
		throw new StaticIntelligenceCodeStructureSnapshotMismatchError(
			"Code structure snapshot project root could not be verified.",
		);
	}
	const expectedRootRef = createHash("sha256")
		.update(realProjectPath)
		.digest("hex");
	if (snapshot.project.rootRef !== expectedRootRef) {
		throw new StaticIntelligenceCodeStructureSnapshotMismatchError(
			"Code structure snapshot rootRef does not match scan project.",
		);
	}
}

function extractHandoff(
	bundle: StaticIntelligenceSourceBundle,
	degradedReasons: string[],
): StaticIntelligenceHandoff | null {
	if (bundle.latestReview?.status === "failed") {
		degradedReasons.push("latest scan review failed");
	}

	if (!bundle.latestCompletedReview) {
		if (bundle.latestReview?.status !== "failed") {
			degradedReasons.push("completed scan review missing");
		}
		return null;
	}

	const parsed = scanReviewOutputSchema.safeParse(
		bundle.latestCompletedReview.output,
	);
	if (!parsed.success) {
		degradedReasons.push(
			"completed scan review output did not include a valid improvement request",
		);
		return null;
	}

	const request = parsed.data.improvementRequest;
	return {
		title: sanitizeHandoffText(request.title, bundle.project.repoPath),
		objective: sanitizeHandoffText(request.objective, bundle.project.repoPath),
		acceptanceCriteria: request.acceptanceCriteria.map((item) =>
			sanitizeHandoffText(item, bundle.project.repoPath),
		),
		verificationCommands: request.verificationCommands.map((item) =>
			sanitizeHandoffText(item, bundle.project.repoPath),
		),
		constraints: request.constraints.map((item) =>
			sanitizeHandoffText(item, bundle.project.repoPath),
		),
		nonGoals: request.nonGoals.map((item) =>
			sanitizeHandoffText(item, bundle.project.repoPath),
		),
	};
}

function sanitizeHandoffText(text: string, projectRoot: string): string {
	return redactHomePaths(text.split(projectRoot).join("<project-root>"));
}

function redactHomePaths(text: string): string {
	return text
		.replaceAll(/\/Users\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/\/home\/[^\s"'`)]+/g, "<redacted-path>")
		.replaceAll(/[A-Za-z]:\\Users\\[^\s"'`)]+/g, "<redacted-path>");
}

function scanReviewStatus(
	bundle: StaticIntelligenceSourceBundle,
): "completed" | "failed" | "missing" {
	if (bundle.latestReview?.status === "failed") return "failed";
	if (bundle.latestCompletedReview) return "completed";
	return "missing";
}

function computeRiskBand(
	bundle: StaticIntelligenceSourceBundle,
): StaticIntelligenceRiskBand {
	if (bundle.findings.length === 0) return "none";
	const severities = bundle.findings.map((finding) => finding.severity);
	if (severities.some((severity) => !isKnownSeverity(severity)))
		return "unknown";
	const maxSeverity = severities
		.map((severity) => normalizeSeverity(severity))
		.sort((a, b) => compareSeverity(b, a))[0];
	return severityToRiskBand(maxSeverity ?? "unknown");
}

function computeScanEvidenceQuality(
	findingCount: number,
	qualities: StaticIntelligenceEvidenceQuality[],
): StaticIntelligenceEvidenceQuality {
	if (findingCount === 0) return "none";
	if (qualities.some((quality) => quality === "unknown")) return "unknown";
	if (qualities.every((quality) => quality === "strong")) return "strong";
	if (
		qualities.some((quality) => quality === "mixed") ||
		qualities.some((quality) => quality === "strong")
	) {
		return "mixed";
	}
	return "weak";
}

function severityToRiskBand(
	severity: StaticIntelligenceSeverity,
): StaticIntelligenceRiskBand {
	if (severity === "info") return "low";
	return severity;
}

function isKnownSeverity(value: string): value is StaticIntelligenceSeverity {
	return ["info", "low", "medium", "high", "critical", "unknown"].includes(
		value,
	);
}

function dateToString(value: Date | null): string | null {
	return value ? value.toISOString() : null;
}
