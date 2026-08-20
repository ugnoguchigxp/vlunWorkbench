import { requestJson, requestText } from "./core";

export type Project = {
	id: string;
	ownerUserId: string;
	name: string;
	repoPath: string;
	defaultBranch: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	pathPolicy?: {
		status: "allowed" | "blocked" | "missing";
		reasonCode: string | null;
	};
};

export type ScanRun = {
	id: string;
	projectId: string;
	profile: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	startedAt: string | null;
	completedAt: string | null;
	createdByUserId: string | null;
	summary: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type ScanEvent = {
	id: string;
	scanRunId: string;
	level: "debug" | "info" | "warn" | "error";
	eventType: string;
	message: string;
	data: Record<string, unknown>;
	createdAt: string;
};

export type ScanArtifact = {
	id: string;
	scanRunId: string;
	toolRunId: string | null;
	kind:
		| "raw_result"
		| "stdout"
		| "stderr"
		| "log"
		| "normalized_result"
		| "source_snippet"
		| "report"
		| "diff_manifest";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type FindingDecision = {
	id: string;
	findingId: string;
	decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
	reason:
		| "confirmed_by_evidence"
		| "confirmed_by_review"
		| "insufficient_evidence"
		| "environment_specific"
		| "tool_noise"
		| "not_exploitable"
		| "accepted_risk"
		| "other";
	comment: string | null;
	linkedReviewId: string | null;
	decidedByUserId: string | null;
	metadata?: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type Finding = {
	id: string;
	scanRunId: string;
	projectId: string;
	sourceTool: string;
	ruleId: string;
	title: string;
	description: string;
	severity: "info" | "low" | "medium" | "high" | "critical" | "unknown";
	confidence: "static";
	status: "open";
	primaryLocation: Record<string, unknown> | null;
	fingerprint: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	latestDecision?: FindingDecision | null;
	latestReview?: Partial<FindingReview> | null;
};

export type FindingEvidence = {
	id: string;
	findingId: string;
	kind: "tool-output" | "source-location" | "scan-log";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

// --- Phase 1: CLI Scan Foundation API functions ---

export async function fetchProjects(): Promise<Project[]> {
	const data = await requestJson<{ projects: Project[] }>("/api/projects");
	return data.projects;
}

export async function fetchProject(projectId: string): Promise<Project> {
	const data = await requestJson<{ project: Project }>(
		`/api/projects/${projectId}`,
	);
	return data.project;
}

export async function createProject(params: {
	name?: string;
	repoPath: string;
	defaultBranch?: string;
	metadata?: Record<string, unknown>;
}): Promise<Project> {
	const data = await requestJson<{ project: Project }>("/api/projects", {
		method: "POST",
		body: params,
	});
	return data.project;
}

export type DeleteProjectResult = {
	deletedProjectId: string;
	deletedAt: string;
	artifactCleanup: "queued";
};

export async function deleteProject(
	projectId: string,
	params: { confirmation: string },
): Promise<DeleteProjectResult> {
	return requestJson<DeleteProjectResult>(`/api/projects/${projectId}`, {
		method: "DELETE",
		body: params,
	});
}

export async function browseProjectFolder(): Promise<{ path: string | null }> {
	return requestJson<{ path: string | null }>("/api/projects/folder-picker", {
		method: "POST",
	});
}

export async function fetchScans(projectId: string): Promise<ScanRun[]> {
	const params = new URLSearchParams({ projectId });
	const data = await requestJson<{ scans: ScanRun[] }>(
		`/api/scans?${params.toString()}`,
	);
	return [...data.scans].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function fetchScan(scanRunId: string): Promise<ScanRun> {
	const data = await requestJson<{ scan: ScanRun }>(`/api/scans/${scanRunId}`);
	return data.scan;
}

export async function fetchScanEvents(scanRunId: string): Promise<ScanEvent[]> {
	const data = await requestJson<{ events: ScanEvent[] }>(
		`/api/scans/${scanRunId}/events`,
	);
	return data.events;
}

export async function cancelScan(scanRunId: string): Promise<ScanRun> {
	const data = await requestJson<{ scan: ScanRun }>(
		`/api/scans/${scanRunId}/cancel`,
		{ method: "POST" },
	);
	return data.scan;
}

export type DeleteScanResult = {
	deletedScanRunId: string;
	deletedAt: string;
	artifactCleanup: "queued";
};

export async function deleteScan(scanRunId: string): Promise<DeleteScanResult> {
	return requestJson<DeleteScanResult>(`/api/scans/${scanRunId}`, {
		method: "DELETE",
	});
}

export async function fetchScanArtifacts(
	scanRunId: string,
): Promise<ScanArtifact[]> {
	const data = await requestJson<{ artifacts: ScanArtifact[] }>(
		`/api/scans/${scanRunId}/artifacts`,
	);
	return data.artifacts;
}

export type ScanFindingsPage = {
	findings: Finding[];
	nextCursor: string | null;
};

export async function fetchScanFindingsPage(
	scanRunId: string,
	options: { limit?: number; cursor?: string } = {},
): Promise<ScanFindingsPage> {
	const params = new URLSearchParams({ limit: String(options.limit ?? 100) });
	if (options.cursor) params.set("cursor", options.cursor);
	const data = await requestJson<{
		findings: Finding[];
		nextCursor?: string | null;
	}>(`/api/scans/${scanRunId}/findings?${params.toString()}`);
	return { findings: data.findings, nextCursor: data.nextCursor ?? null };
}

export async function fetchScanFindings(scanRunId: string): Promise<Finding[]> {
	const findings: Finding[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	do {
		const page = await fetchScanFindingsPage(scanRunId, { cursor });
		findings.push(...page.findings);
		cursor = page.nextCursor ?? undefined;
		if (cursor) {
			if (seenCursors.has(cursor)) {
				throw new Error("Finding pagination returned a repeated cursor.");
			}
			seenCursors.add(cursor);
		}
	} while (cursor);
	return findings;
}

export * from "./scans-intelligence";

export type FindingReview = {
	id: string;
	findingId: string;
	provider: string;
	model: string;
	status: "running" | "completed" | "failed";
	summary: string | null;
	likelyImpact: string | null;
	falsePositiveAssessment: {
		level: "low" | "medium" | "high" | "unknown";
		reasoning: string;
	} | null;
	evidenceStrength: {
		level: "weak" | "moderate" | "strong" | "unknown";
		reasoning: string;
	} | null;
	remediationDirection: string | null;
	reviewerNotes: string[] | null;
	confidenceAdjustment: "unchanged" | "increase" | "decrease" | "unknown";
	inputBundle: Record<string, unknown> | null;
	output: Record<string, unknown> | null;
	errorMessage: string | null;
	createdByUserId: string | null;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export async function fetchFinding(findingId: string): Promise<{
	finding: Finding;
	evidence: FindingEvidence[];
	latestReview: FindingReview | null;
	latestDecision: FindingDecision | null;
}> {
	return requestJson<{
		finding: Finding;
		evidence: FindingEvidence[];
		latestReview: FindingReview | null;
		latestDecision: FindingDecision | null;
	}>(`/api/findings/${findingId}`);
}

export async function fetchFindingReviews(
	findingId: string,
): Promise<{ reviews: FindingReview[] }> {
	return requestJson<{ reviews: FindingReview[] }>(
		`/api/findings/${findingId}/reviews`,
	);
}

export async function triggerFindingReview(findingId: string): Promise<{
	ok: boolean;
	reviewId: string;
	status: "completed" | "failed";
	error?: string;
}> {
	return requestJson<{
		ok: boolean;
		reviewId: string;
		status: "completed" | "failed";
		error?: string;
	}>(`/api/findings/${findingId}/reviews`, {
		method: "POST",
	});
}

export async function fetchFindingReview(
	reviewId: string,
): Promise<{ review: FindingReview }> {
	return requestJson<{ review: FindingReview }>(
		`/api/finding-reviews/${reviewId}`,
	);
}

export async function fetchFindingDecisions(
	findingId: string,
): Promise<{ decisions: FindingDecision[] }> {
	return requestJson<{ decisions: FindingDecision[] }>(
		`/api/findings/${findingId}/decisions`,
	);
}

export async function createFindingDecision(
	findingId: string,
	params: {
		decision: "accepted" | "false_positive" | "deferred" | "needs_fix";
		reason: string;
		comment?: string;
		linkedReviewId?: string;
		metadata?: Record<string, unknown>;
	},
): Promise<{ decision: FindingDecision }> {
	return requestJson<{ decision: FindingDecision }>(
		`/api/findings/${findingId}/decisions`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function fetchFindingDecision(
	decisionId: string,
): Promise<{ decision: FindingDecision }> {
	return requestJson<{ decision: FindingDecision }>(
		`/api/finding-decisions/${decisionId}`,
	);
}

// --- Phase 5: Markdown Report Export API functions ---

export type ScanReport = {
	id: string;
	scanRunId: string;
	artifactId: string | null;
	format: string;
	title: string;
	summary: string | null;
	options: {
		includeFalsePositives: boolean;
		includeDeferred: boolean;
		includeUndecided: boolean;
		summaryMode?: "deterministic" | "deterministic_with_llm_summary";
		providerRouting?: Record<string, unknown>;
	};
	status: "queued" | "running" | "completed" | "failed";
	errorMessage: string | null;
	generatedByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CreateScanReportInput = {
	format: string;
	title: string;
	includeFalsePositives: boolean;
	includeDeferred: boolean;
	includeUndecided: boolean;
	summaryMode?: "deterministic" | "deterministic_with_llm_summary";
};

export async function generateScanReport(
	scanRunId: string,
	input: CreateScanReportInput,
): Promise<{ report: ScanReport }> {
	return requestJson<{ report: ScanReport }>(
		`/api/scans/${scanRunId}/reports`,
		{
			method: "POST",
			body: input,
		},
	);
}

export type ScanReview = {
	id: string;
	scanRunId: string;
	projectId: string;
	provider: string;
	model: string;
	status: "running" | "completed" | "failed";
	summary: string | null;
	riskOverview: string | null;
	priorityNotes: string[];
	coverageNotes: string[];
	falsePositiveHotspots: string[];
	recommendedNextActions: string[];
	findingTriageHints: Array<Record<string, unknown>>;
	confidenceNotes: string[];
	output?: Record<string, unknown>;
	errorMessage: string | null;
	createdAt: string;
	startedAt: string | null;
	completedAt: string | null;
	updatedAt: string;
};

export type ScanImprovementRequest = {
	title: string;
	objective: string;
	scope: string[];
	priorityPlan: Array<{
		priority: "critical" | "high" | "medium" | "low";
		rationale: string;
		findingIds: string[];
	}>;
	implementationTasks: Array<{
		title: string;
		body: string;
		findingIds: string[];
		evidenceRefs: string[];
	}>;
	acceptanceCriteria: string[];
	verificationCommands: string[];
	constraints: string[];
	nonGoals: string[];
	handoffPrompt: string;
};

export type ScanReviewFindingFilter =
	| "all"
	| "high_or_critical"
	| "weak_or_missing_evidence"
	| "new_or_regressed";

export async function fetchScanReviews(
	scanRunId: string,
): Promise<ScanReview[]> {
	const data = await requestJson<{ reviews: ScanReview[] }>(
		`/api/scans/${scanRunId}/reviews`,
	);
	return [...data.reviews].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function triggerScanReview(
	scanRunId: string,
	input: { findingFilter?: ScanReviewFindingFilter } = {},
): Promise<{
	review: ScanReview | null;
	result: {
		ok: boolean;
		reviewId: string;
		status: "running" | "failed";
		error?: string;
	};
}> {
	return requestJson<{
		review: ScanReview | null;
		result: {
			ok: boolean;
			reviewId: string;
			status: "running" | "failed";
			error?: string;
		};
	}>(`/api/scans/${scanRunId}/reviews`, { method: "POST", body: input });
}

export async function fetchScanReports(
	scanRunId: string,
): Promise<ScanReport[]> {
	const data = await requestJson<{ reports: ScanReport[] }>(
		`/api/scans/${scanRunId}/reports`,
	);
	return [...data.reports].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function fetchScanReport(
	reportId: string,
): Promise<{ report: ScanReport }> {
	return requestJson<{ report: ScanReport }>(`/api/scan-reports/${reportId}`);
}

export type ScanReportViewerState = {
	llmCommentSeenAt: string | null;
};

export async function fetchScanReportViewerState(
	reportId: string,
): Promise<ScanReportViewerState> {
	const data = await requestJson<{ viewerState: ScanReportViewerState }>(
		`/api/scan-reports/${reportId}/viewer-state`,
	);
	return data.viewerState;
}

export async function markScanReportLlmCommentSeen(
	reportId: string,
): Promise<ScanReportViewerState> {
	const data = await requestJson<{ viewerState: ScanReportViewerState }>(
		`/api/scan-reports/${reportId}/viewer-state`,
		{ method: "PUT", body: { llmCommentSeen: true } },
	);
	return data.viewerState;
}

export async function downloadScanReportMarkdown(
	reportId: string,
): Promise<string> {
	return await requestText(`/api/scan-reports/${reportId}/download`);
}

export * from "./scans-execution";
