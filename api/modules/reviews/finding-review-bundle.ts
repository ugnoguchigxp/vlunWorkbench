import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../scans/normalizers/redaction";
import type {
	ReviewInputBundle,
	ReviewFindingInfo,
	ReviewScanContext,
	ReviewEvidenceInfo,
	ReviewSourceSnapshot,
} from "./finding-review-types";
import type { AppDatabase } from "../../db";
import { eq } from "drizzle-orm";
import {
	scanArtifacts,
	scanExecutionPlans,
	scanRuns,
	toolRuns,
} from "../../db/schema";

export interface ExtractSnippetOptions {
	maxLines?: number;
	maxFileBytes?: number;
}

type ToolRunRow = typeof toolRuns.$inferSelect;

function normalizedToolName(value: string): string {
	return value.trim().toLowerCase();
}

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function selectFindingToolRun(
	findingSourceTool: string,
	scanToolRuns: ToolRunRow[],
	evidenceToolRunIds: Set<string>,
): ToolRunRow | null {
	const sourceTool = normalizedToolName(findingSourceTool);
	const evidenceRuns = scanToolRuns.filter((run) =>
		evidenceToolRunIds.has(run.id),
	);
	const evidenceMatches = evidenceRuns.filter(
		(run) => normalizedToolName(run.toolName) === sourceTool,
	);
	if (evidenceMatches.length === 1) return evidenceMatches[0] ?? null;

	const scanMatches = scanToolRuns.filter(
		(run) => normalizedToolName(run.toolName) === sourceTool,
	);
	return scanMatches.length === 1 ? (scanMatches[0] ?? null) : null;
}

function locationMatches(
	left: Record<string, unknown> | null,
	right: Record<string, unknown> | null,
): boolean {
	if (!left || !right || typeof left.path !== "string") return false;
	if (left.path !== right.path) return false;
	for (const key of ["startLine", "endLine"] as const) {
		if (
			typeof left[key] === "number" &&
			typeof right[key] === "number" &&
			left[key] !== right[key]
		) {
			return false;
		}
	}
	return true;
}

export async function extractSourceSnippet(
	repoPath: string,
	relativeFilePath: string,
	startLine: number,
	endLine: number,
	options: ExtractSnippetOptions = {},
): Promise<string> {
	const maxLines = options.maxLines ?? 50;
	const maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024; // 10MB

	try {
		let resolvedRepoPath = path.resolve(repoPath);
		try {
			resolvedRepoPath = await fs.realpath(resolvedRepoPath);
		} catch {
			// If repository path does not exist, keep unresolved and fail on target path check
		}
		const targetPath = path.resolve(resolvedRepoPath, relativeFilePath);

		// 1. Path traversal check
		const relative = path.relative(resolvedRepoPath, targetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) {
			return "snippetUnavailable: Path traversal detected.";
		}

		// 2. Symlink target check
		let realPath: string;
		try {
			realPath = await fs.realpath(targetPath);
		} catch {
			return "snippetUnavailable: File not found or inaccessible.";
		}

		const realRelative = path.relative(resolvedRepoPath, realPath);
		if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
			return "snippetUnavailable: Symlink target is outside of project repository.";
		}

		// 3. File metadata & size check
		const stats = await fs.stat(realPath);
		if (!stats.isFile()) {
			return "snippetUnavailable: Target is not a file.";
		}
		if (stats.size > maxFileBytes) {
			return `snippetUnavailable: File size exceeds limit (${stats.size} bytes).`;
		}

		// 4. Binary check
		const content = await fs.readFile(realPath, "utf8");
		if (content.includes("\0")) {
			return "snippetUnavailable: Binary file detected.";
		}

		// 5. Line range extraction
		const lines = content.split(/\r?\n/);
		const totalLines = lines.length;

		const startIdx = Math.max(0, startLine - 1);
		const endIdx = Math.min(totalLines - 1, endLine - 1);

		if (startIdx >= totalLines) {
			return "snippetUnavailable: Start line is out of file bounds.";
		}

		const count = Math.min(maxLines, endIdx - startIdx + 1);
		const slicedLines = lines.slice(startIdx, startIdx + count);

		const rawSnippet = slicedLines.join("\n");
		return redactSecrets(rawSnippet);
	} catch (err) {
		return `snippetUnavailable: ${(err as Error).message}`;
	}
}

/**
 * Builds the input bundle for a finding from the database.
 */
export async function buildReviewBundle(
	db: AppDatabase,
	finding: {
		id: string;
		scanRunId: string;
		projectId: string;
		sourceTool: string;
		ruleId: string;
		title: string;
		description: string;
		severity: string;
		confidence: string;
		status: string;
		primaryLocation: Record<string, unknown> | null;
	},
	repoPath: string,
	options: ExtractSnippetOptions = {},
): Promise<ReviewInputBundle> {
	// Kept in the public signature for callers that also use extractSourceSnippet.
	// Review evidence itself is deliberately independent of the current worktree.
	void repoPath;
	void options;
	// 1. Fetch scan context
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, finding.scanRunId));

	if (!scanRun) {
		throw new Error(`Scan run not found: ${finding.scanRunId}`);
	}

	const scanToolRuns = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, finding.scanRunId));
	const [savedExecutionPlan] = await db
		.select()
		.from(scanExecutionPlans)
		.where(eq(scanExecutionPlans.scanRunId, finding.scanRunId));

	// 2. Fetch evidence list
	const rawEvidences = await db.query.findingEvidences.findMany({
		where: (fields, { eq }) => eq(fields.findingId, finding.id),
	});

	const evidences: ReviewEvidenceInfo[] = [];
	const evidenceToolRunIds = new Set<string>();

	for (const rev of rawEvidences) {
		let artifactInfo: ReviewEvidenceInfo["artifact"] = null;

		if (rev.artifactId) {
			const [art] = await db
				.select()
				.from(scanArtifacts)
				.where(eq(scanArtifacts.id, rev.artifactId));
			if (art) {
				if (art.toolRunId) evidenceToolRunIds.add(art.toolRunId);
				artifactInfo = {
					id: art.id,
					toolRunId: art.toolRunId,
					kind: art.kind,
					format: art.format,
					sha256: art.sha256,
					sizeBytes: art.sizeBytes,
				};
			}
		}

		evidences.push({
			id: rev.id,
			kind: rev.kind,
			title: rev.title,
			location: (rev.location as Record<string, unknown>) ?? null,
			snippet: rev.snippet ? redactSecrets(rev.snippet) : null,
			artifact: artifactInfo,
		});
	}

	const toolRun = selectFindingToolRun(
		finding.sourceTool,
		scanToolRuns,
		evidenceToolRunIds,
	);
	const scanContext: ReviewScanContext = {
		scanRunId: scanRun.id,
		profile: scanRun.profile,
		toolName: toolRun?.toolName ?? finding.sourceTool,
		toolVersion: toolRun?.toolVersion ?? null,
		command: toolRun?.command ? redactSecrets(toolRun.command) : null,
	};

	// 3. Use only the persisted source evidence captured with the finding.
	const persistedSource = rawEvidences.find(
		(evidence) =>
			evidence.kind === "source-location" &&
			Boolean(evidence.snippet) &&
			locationMatches(
				(evidence.location as Record<string, unknown>) ?? null,
				finding.primaryLocation,
			),
	);
	const persistedSourceArtifact = persistedSource?.artifactId
		? (evidences.find((evidence) => evidence.id === persistedSource.id)
				?.artifact ?? null)
		: null;
	const sourceSnippet = persistedSource?.snippet
		? redactSecrets(persistedSource.snippet)
		: "snippetUnavailable: No persisted source snapshot matches the finding location.";
	const executionPlan = savedExecutionPlan?.plan ?? {};
	const sourceIdentity = {
		executionPlanId: savedExecutionPlan?.id ?? null,
		planHash: savedExecutionPlan?.planHash ?? null,
		sourceRevision: optionalString(executionPlan.sourceRevision),
		sourceSnapshotDigest: optionalString(executionPlan.sourceSnapshotDigest),
	};
	const sourceSnapshot: ReviewSourceSnapshot = persistedSource
		? {
				status: "available",
				evidenceId: persistedSource.id,
				artifactId: persistedSourceArtifact?.id ?? null,
				artifactSha256: persistedSourceArtifact?.sha256 ?? null,
				...sourceIdentity,
				capturedAt:
					persistedSource.createdAt instanceof Date
						? persistedSource.createdAt.toISOString()
						: String(persistedSource.createdAt),
			}
		: {
				status: "unavailable",
				evidenceId: null,
				artifactId: null,
				artifactSha256: null,
				...sourceIdentity,
				capturedAt: null,
			};

	const findingInfo: ReviewFindingInfo = {
		id: finding.id,
		sourceTool: finding.sourceTool,
		ruleId: finding.ruleId,
		title: finding.title,
		description: finding.description,
		severity: finding.severity,
		confidence: finding.confidence,
		status: finding.status,
		primaryLocation:
			(finding.primaryLocation as Record<string, unknown>) ?? null,
	};

	return {
		finding: findingInfo,
		scanContext,
		evidences,
		sourceSnippet,
		sourceSnapshot,
	};
}
