import type {
	ProjectStructureCoverage,
	ProjectStructureDiagnostic,
	ProjectStructureSnapshotV2,
} from "../../../shared/schemas/project-structure.schema";
import type {
	FileRiskIndexEntry,
	StaticIntelligenceExportV1,
} from "../../../shared/schemas/static-intelligence.schema";
import type {
	StaticIntelligenceAgentQueryKind,
	StaticIntelligenceAgentQueryResult,
} from "../../../shared/schemas/static-intelligence-agent-query.schema";
import type { StaticIntelligenceKnowledgeSourceManifest } from "../../../shared/schemas/static-intelligence-knowledge-source.schema";
import type {
	IntelligenceReadinessStatus,
	StaticIntelligenceModuleCandidate,
	StaticIntelligenceOntologyHandoff,
	StaticIntelligenceReadiness,
} from "../../../shared/schemas/static-intelligence-module.schema";
import type {
	DiffScanPreview,
	ScanTarget,
	ScanTargetKind,
} from "../../../shared/schemas/scan-target.schema";
import { requestJson } from "./core";

// --- Phase 1: CLI Scan Foundation Types ---

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

export async function fetchScanArtifacts(
	scanRunId: string,
): Promise<ScanArtifact[]> {
	const data = await requestJson<{ artifacts: ScanArtifact[] }>(
		`/api/scans/${scanRunId}/artifacts`,
	);
	return data.artifacts;
}

export async function fetchScanFindings(scanRunId: string): Promise<Finding[]> {
	const data = await requestJson<{ findings: Finding[] }>(
		`/api/scans/${scanRunId}/findings`,
	);
	return data.findings;
}

export type ProjectIntelligenceView = {
	project: ProjectIntelligenceProject;
	latestUsableScan: ScanRun | null;
	selectedScan: ScanRun | null;
	selection: {
		requestedScanRunId: string | null;
		selectedScanRunId: string | null;
		isLatest: boolean;
		selectionReason:
			| "requested"
			| "latest_completed"
			| "latest_terminal_degraded"
			| "none";
	};
	generation: {
		generationId: string;
		generatedAt: string;
		sourceTreeHash: string;
		sourceStateHash: string;
		snapshotRef?: string;
		exportHash: string;
		status: IntelligenceReadinessStatus;
	} | null;
	export: StaticIntelligenceExportV1 | null;
	manifest: StaticIntelligenceKnowledgeSourceManifest | null;
	readiness: StaticIntelligenceReadiness;
	degradedReasons: string[];
};

export type ProjectIntelligenceSummary = {
	project: ProjectIntelligenceProject;
	projectId: string;
	selectedScanRunId: string | null;
	scanStatus: string | null;
	riskBand: string;
	evidenceQuality: string;
	findingCount: number;
	codeStructureStatus: IntelligenceReadinessStatus;
	generationStatus: IntelligenceReadinessStatus;
	generatedAt: string | null;
	degradedReasonCount: number;
};

export type ProjectIntelligenceProject = {
	id: string;
	name: string;
	repositoryName: string;
	defaultBranch: string;
	createdAt: string;
	updatedAt: string;
};

export type ProjectStructureListResponse = {
	status: IntelligenceReadinessStatus | "available" | "degraded";
	generationId?: string;
	items: Array<{
		path: string;
		language: string;
		moduleKind: string;
		tags: string[];
		analysisStatus: string;
		referenceCount: number;
		exportCount: number;
		externalDependencyCount: number;
		risk: FileRiskIndexEntry | null;
	}>;
	modules: StaticIntelligenceModuleCandidate[];
	nextCursor: number | null;
	total?: number;
	summary?: ProjectStructureSnapshotV2["summary"];
	coverage?: ProjectStructureCoverage;
	readiness?: ProjectStructureSnapshotV2["readiness"];
	diagnostics?: ProjectStructureDiagnostic[];
};

export type ScanIntelligenceExportResponse = {
	export: StaticIntelligenceExportV1;
};

export type ScanIntelligenceAgentMode =
	| "overview"
	| "risk"
	| "evidence"
	| "verification"
	| "export";

export type ScanIntelligenceAgentQueryResponse = {
	result: StaticIntelligenceAgentQueryResult;
};

export const agentModeToQueryKind: Record<
	ScanIntelligenceAgentMode,
	StaticIntelligenceAgentQueryKind
> = {
	overview: "project_overview",
	risk: "risk_context",
	evidence: "evidence_bundle",
	verification: "verification_commands",
	export: "export_static_intelligence",
};

export async function fetchProjectIntelligenceView(
	projectId: string,
	scanRunId?: string | null,
): Promise<ProjectIntelligenceView> {
	const search = new URLSearchParams();
	if (scanRunId) search.set("scanRunId", scanRunId);
	return requestJson<ProjectIntelligenceView>(
		`/api/projects/${projectId}/intelligence${search.size ? `?${search.toString()}` : ""}`,
	);
}

export async function fetchProjectIntelligenceSummaries(): Promise<
	ProjectIntelligenceSummary[]
> {
	const data = await requestJson<{ summaries: ProjectIntelligenceSummary[] }>(
		"/api/projects/intelligence-summaries",
	);
	return data.summaries;
}

export async function fetchProjectStructure(
	projectId: string,
	scanRunId: string,
	params: {
		generationId?: string;
		query?: string;
		analyzerId?: string;
		kind?: string;
		status?: string;
		cursor?: number;
		limit?: number;
	} = {},
): Promise<ProjectStructureListResponse> {
	const search = new URLSearchParams({ scanRunId, view: "files" });
	for (const [key, value] of Object.entries(params))
		if (value !== undefined && value !== "") search.set(key, String(value));
	return requestJson<ProjectStructureListResponse>(
		`/api/projects/${projectId}/intelligence/project-structure?${search.toString()}`,
	);
}

export async function fetchProjectOntologyHandoff(
	projectId: string,
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceOntologyHandoff | null> {
	const data = await requestJson<{
		handoff: StaticIntelligenceOntologyHandoff | null;
	}>(
		`/api/projects/${projectId}/intelligence/ontology-handoff?${new URLSearchParams(
			{
				scanRunId,
				...(generationId ? { generationId } : {}),
			},
		).toString()}`,
	);
	return data.handoff;
}

export async function refreshProjectIntelligence(
	projectId: string,
	scanRunId: string,
	includeSemantic = false,
): Promise<{ ok: true; status: "completed" | "partial" }> {
	return requestJson(`/api/projects/${projectId}/intelligence/refresh`, {
		method: "POST",
		body: { scanRunId, includeSemantic },
	});
}

export async function fetchScanIntelligenceExport(
	scanRunId: string,
	generationId?: string,
): Promise<StaticIntelligenceExportV1> {
	const search = generationId
		? `?${new URLSearchParams({ generationId }).toString()}`
		: "";
	const data = await requestJson<ScanIntelligenceExportResponse>(
		`/api/scans/${scanRunId}/intelligence/export${search}`,
	);
	return data.export;
}

export async function fetchScanIntelligenceAgentQuery(
	scanRunId: string,
	params: {
		mode: ScanIntelligenceAgentMode;
		generationId?: string;
		query?: string;
		findingId?: string;
		file?: string;
		ruleId?: string;
		scanner?: string;
	},
): Promise<StaticIntelligenceAgentQueryResult> {
	const search = new URLSearchParams({ mode: params.mode });
	for (const key of [
		"generationId",
		"query",
		"findingId",
		"file",
		"ruleId",
		"scanner",
	] as const) {
		const value = params[key];
		if (value) search.set(key, value);
	}
	const data = await requestJson<ScanIntelligenceAgentQueryResponse>(
		`/api/scans/${scanRunId}/intelligence/agent-query?${search.toString()}`,
	);
	return data.result;
}

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
	status: "running" | "completed" | "failed";
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

export type ScanProfileTool = {
	toolId: string;
	displayName: string;
	required: boolean;
	timeoutSec?: number;
};

export type ScanProfileStep =
	| {
			kind: "static_tool";
			toolId: string;
			displayName: string;
			required: boolean;
			timeoutSec?: number;
			failurePolicy: "fail_profile" | "warn_and_continue";
	  }
	| {
			kind: "dast";
			profileId: "http-baseline";
			displayName: string;
			required: boolean;
			timeoutSec?: number;
			failurePolicy: "fail_profile" | "warn_and_continue";
			target: { mode: "auto_project_start" };
	  };

export type ScanProfileScope = {
	intent: "source" | "dependency_manifest" | "artifact" | "full_deep";
	includeGenerated: boolean;
	includeInstalledDependencies: boolean;
	includeVendoredDependencies: boolean;
	notes?: string;
};

export type ScanProfile = {
	id: string;
	name: string;
	description: string;
	enabled: boolean;
	defaultTimeoutSec: number;
	supportedTargets?: ScanTargetKind[];
	scope?: ScanProfileScope;
	tools: ScanProfileTool[];
	steps?: ScanProfileStep[];
};

export type ToolSummary = {
	toolId: string;
	toolRunId: string | null;
	status: string;
	required: boolean;
	exitCode: number | null;
	toolVersion: string | null;
	findingCount: number;
	severityCounts: {
		critical: number;
		high: number;
		medium: number;
		low: number;
		info: number;
		unknown: number;
	};
	artifactCount: number;
	error: string | null;
	metadata?: Record<string, unknown>;
};

export type StepSummary = {
	kind:
		| "static_tool"
		| "dast"
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	id: string;
	displayName: string;
	status: string;
	required: boolean;
	findingCount: number;
	artifactCount: number;
	error: string | null;
	outcome?: string | null;
	targetOrigin?: string | null;
	applicability?: "applicable" | "not_applicable";
	reasonCode?: string | null;
	coverageEffect?: "covered" | "partial" | "gap";
	metadata?: Record<string, unknown>;
};

export type ScanStartToolResult = {
	toolId: string;
	toolRunId: string | null;
	status: string;
	exitCode: number | null;
	findingCount: number;
	error: string | null;
	applicability?: "applicable" | "not_applicable";
	reasonCode?: string | null;
	coverageEffect?: "covered" | "partial" | "gap";
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
};

export type ScanStartCoverageStepResult = {
	kind:
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	stepId: string;
	adapter: string;
	required: boolean;
	status: string;
	applicability: "applicable" | "not_applicable";
	reasonCode: string | null;
	coverageEffect: "covered" | "partial" | "gap";
	findingCount: number;
	error: string | null;
	artifactIds?: string[];
	metadata?: Record<string, unknown>;
};

export type ScanStartStepResult =
	| (ScanStartToolResult & {
			kind: "static_tool";
			required: boolean;
	  })
	| {
			kind: "dast";
			profileId: string;
			required: boolean;
			status: string;
			outcome: string | null;
			findingCount: number;
			dastRunId: string | null;
			targetOrigin: string | null;
			error: string | null;
			autoTarget?: {
				scriptName: string;
				command: string[];
				port: number;
				origin: string;
				warnings: string[];
			};
	  }
	| ScanStartCoverageStepResult;

export type ScanRunSummary = {
	scanRunId: string;
	profileId: string;
	profileOutcome: string;
	tools: ToolSummary[];
	steps?: StepSummary[];
	totals: {
		findingCount: number;
		artifactCount: number;
		reviewedFindingCount: number;
		decidedFindingCount: number;
	};
};

export type FindingGroup = {
	id: string;
	groupKey: string;
	title: string;
	severity: string;
	findingIds: string[];
	sourceTools: string[];
	metadata: {
		strategy: string;
	};
};

export type GroupedFindingsResult = {
	groups: FindingGroup[];
};

export type AttackSurfaceItem = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	category: string;
	name: string;
	kind: string;
	locationJson: Record<string, unknown>;
	boundaryJson: Record<string, unknown>;
	evidenceRefsJson: Array<Record<string, unknown>>;
	confidence: "high" | "medium" | "low";
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type SecurityCheckResult = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	checkId: string;
	attackSurfaceItemId: string | null;
	status:
		| "pass"
		| "fail"
		| "warn"
		| "not_applicable"
		| "manual_review"
		| "not_checked";
	outcome: string | null;
	title: string;
	summary: string;
	evidenceRefsJson: Array<Record<string, unknown>>;
	remediationHint: string | null;
	coverageGap: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type DiagnosticReport = {
	id: string;
	projectId: string;
	scanRunId: string;
	reportKind: "zero-finding";
	status: "running" | "completed" | "failed";
	summary: string | null;
	checkedCategoriesJson: Array<Record<string, unknown>>;
	coverageGapsJson: Array<Record<string, unknown>>;
	residualRisksJson: Array<Record<string, unknown>>;
	recommendedNextActionsJson: Array<Record<string, unknown>>;
	artifactId: string | null;
	metadata: Record<string, unknown>;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

export async function fetchScanProfiles(): Promise<ScanProfile[]> {
	const data = await requestJson<{ profiles: ScanProfile[] }>(
		"/api/scan-profiles",
	);
	return data.profiles;
}

export async function startScan(
	projectId: string,
	params: {
		profile: string;
		continueOnToolFailure?: boolean;
		timeoutSec?: number;
		runner?: "host" | "docker";
		dockerBin?: string;
		dockerImage?: string;
		network?: "none" | "default";
		toolCacheDir?: string;
		imageRef?: string;
		imageTar?: string;
		target?: ScanTarget;
		expectedTargetDigest?: string;
	},
): Promise<{
	scan: { id: string; status: string; profile: string };
	runner?: "host" | "docker";
	profileOutcome: string;
	message?: string;
	toolResults: ScanStartToolResult[];
	stepResults?: ScanStartStepResult[];
}> {
	return requestJson<{
		scan: { id: string; status: string; profile: string };
		runner?: "host" | "docker";
		profileOutcome: string;
		message?: string;
		toolResults: ScanStartToolResult[];
		stepResults?: ScanStartStepResult[];
	}>(`/api/projects/${projectId}/scans`, {
		method: "POST",
		body: params,
	});
}

export async function previewScan(
	projectId: string,
	params: {
		profile: string;
		target: Exclude<ScanTarget, { kind: "full" }>;
	},
): Promise<DiffScanPreview> {
	return requestJson<DiffScanPreview>(
		`/api/projects/${projectId}/scans/preview`,
		{
			method: "POST",
			body: params,
		},
	);
}

export type { DiffScanPreview, ScanTarget, ScanTargetKind };

export async function fetchScanSummary(
	scanRunId: string,
): Promise<ScanRunSummary> {
	const data = await requestJson<{ summary: ScanRunSummary }>(
		`/api/scans/${scanRunId}/summary`,
	);
	return data.summary;
}

export async function fetchScanGroups(
	scanRunId: string,
): Promise<GroupedFindingsResult> {
	return requestJson<GroupedFindingsResult>(`/api/scans/${scanRunId}/groups`);
}

export async function fetchScanAttackSurface(
	scanRunId: string,
): Promise<{ items: AttackSurfaceItem[] }> {
	return requestJson<{ items: AttackSurfaceItem[] }>(
		`/api/scans/${scanRunId}/attack-surface`,
	);
}

export async function runScanAttackSurfaceInventory(
	scanRunId: string,
): Promise<{
	ok: boolean;
	inventoryCount: number;
	categories: Record<string, number>;
}> {
	return requestJson<{
		ok: boolean;
		inventoryCount: number;
		categories: Record<string, number>;
	}>(`/api/scans/${scanRunId}/attack-surface/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanSecurityChecks(
	scanRunId: string,
): Promise<{ results: SecurityCheckResult[] }> {
	return requestJson<{ results: SecurityCheckResult[] }>(
		`/api/scans/${scanRunId}/security-checks`,
	);
}

export async function runScanSecurityChecks(scanRunId: string): Promise<{
	ok: boolean;
	resultCount: number;
	statusCounts: Record<string, number>;
}> {
	return requestJson<{
		ok: boolean;
		resultCount: number;
		statusCounts: Record<string, number>;
	}>(`/api/scans/${scanRunId}/security-checks/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanDiagnosticReports(
	scanRunId: string,
): Promise<{ reports: DiagnosticReport[] }> {
	return requestJson<{ reports: DiagnosticReport[] }>(
		`/api/scans/${scanRunId}/diagnostic-reports`,
	);
}

export async function generateDiagnosticReport(scanRunId: string): Promise<{
	ok: boolean;
	reportId: string;
	artifactId: string | null;
	status: string;
	summary: string;
}> {
	return requestJson<{
		ok: boolean;
		reportId: string;
		artifactId: string | null;
		status: string;
		summary: string;
	}>(`/api/scans/${scanRunId}/diagnostic-reports`, {
		method: "POST",
		body: { kind: "zero-finding" },
	});
}
