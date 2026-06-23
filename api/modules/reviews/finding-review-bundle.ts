import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../scans/normalizers/fixture";
import type {
	ReviewInputBundle,
	ReviewFindingInfo,
	ReviewScanContext,
	ReviewEvidenceInfo,
} from "./finding-review-types";
import type { AppDatabase } from "../../db";
import { eq } from "drizzle-orm";
import { scanRuns, toolRuns, scanArtifacts } from "../../db/schema";

export interface ExtractSnippetOptions {
	maxLines?: number;
	maxFileBytes?: number;
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
	// 1. Fetch scan context
	const [scanRun] = await db
		.select()
		.from(scanRuns)
		.where(eq(scanRuns.id, finding.scanRunId));

	if (!scanRun) {
		throw new Error(`Scan run not found: ${finding.scanRunId}`);
	}

	// Fetch tool run if it exists
	const [toolRun] = await db
		.select()
		.from(toolRuns)
		.where(eq(toolRuns.scanRunId, finding.scanRunId));

	const scanContext: ReviewScanContext = {
		scanRunId: scanRun.id,
		profile: scanRun.profile,
		toolName: toolRun?.toolName ?? finding.sourceTool,
		toolVersion: toolRun?.toolVersion ?? null,
		command: toolRun?.command ? redactSecrets(toolRun.command) : null,
	};

	// 2. Fetch evidence list
	const rawEvidences = await db.query.findingEvidences.findMany({
		where: (fields, { eq }) => eq(fields.findingId, finding.id),
	});

	const evidences: ReviewEvidenceInfo[] = [];

	for (const rev of rawEvidences) {
		let artifactInfo: ReviewEvidenceInfo["artifact"] = null;

		if (rev.artifactId) {
			const [art] = await db
				.select()
				.from(scanArtifacts)
				.where(eq(scanArtifacts.id, rev.artifactId));
			if (art) {
				artifactInfo = {
					id: art.id,
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

	// 3. Extract source snippet
	let sourceSnippet = "";
	const location = finding.primaryLocation;
	if (location && typeof location.path === "string") {
		const startLine =
			typeof location.startLine === "number" ? location.startLine : 1;
		const endLine =
			typeof location.endLine === "number" ? location.endLine : startLine;

		sourceSnippet = await extractSourceSnippet(
			repoPath,
			location.path,
			startLine,
			endLine,
			options,
		);
	} else {
		sourceSnippet =
			"snippetUnavailable: Finding contains no primary location path.";
	}

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
	};
}
