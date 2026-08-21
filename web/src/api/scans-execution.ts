import type { ScanExecutionPlan } from "../../../shared/schemas/scan-execution-plan.schema";
import type { ScanPreflightResult } from "../../../shared/schemas/scan-preflight.schema";
import type {
	DiffScanPreview,
	ScanTarget,
	ScanTargetKind,
} from "../../../shared/schemas/scan-target.schema";
import { requestJson } from "./core";
import type { Finding, FindingEvidence } from "./scans";

export type ScanProfileTool = {
	toolId: string;
	displayName: string;
	required: boolean;
	timeoutSec?: number;
};

export type ScanProfileStep = {
	stepId: string;
	kind:
		| "static_tool"
		| "dast"
		| "runtime_scanner"
		| "sbom_export"
		| "api_schema_scan"
		| "container_image_scan";
	adapter: string;
	displayName: string;
	required: boolean;
	timeoutSec?: number;
	failurePolicy: "fail_profile" | "warn_and_continue";
	toolId?: string;
	profileId?: string;
	target?: { mode: "auto_project_start" };
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
	steps: ScanProfileStep[];
	coverageGaps?: string[];
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
	verdict?: string | null;
	coverageStatus?: "covered" | "partial" | "gap" | null;
	coverageSummary?: Record<string, unknown> | null;
	limitationCodes?: string[];
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
			verdict?: string | null;
			coverageStatus?: "covered" | "partial" | "gap" | null;
			coverageSummary?: Record<string, unknown> | null;
			limitationCodes?: string[];
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
	coverageResults?: import("./assessments").ScanCoverageResultView[];
};

export type FindingGroup = {
	id: string;
	groupKey: string;
	title: string;
	description: string;
	severity: string;
	representativeFindingId: string;
	findingIds: string[];
	sourceTools: string[];
	primaryLocation: Record<string, unknown>;
	matchConfidence: "exact" | "high" | "singleton";
	reasonCodes: string[];
	metadata: { strategy: string; algorithmVersion: string };
};

export type GroupedFindingsResult = {
	grouping?: {
		runId: string | null;
		runStatus: "completed" | null;
		mode: "deterministic" | "singleton_fallback";
		algorithmVersion: string;
		findingSetHash: string | null;
		snapshotHash: string | null;
		rawFindingCount: number;
		issueCount: number;
		suppressedCount: number;
		ambiguousCount: number;
		limitations: string[];
	};
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
		consentProjectCodeExecution?: boolean;
		timeoutSec?: number;
		runner?: "host" | "docker";
		imageRef?: string;
		imageTar?: string;
		target?: ScanTarget;
		expectedTargetDigest?: string;
		expectedPreflightBindingHash?: string;
		expectedPlanHash?: string;
	},
): Promise<{
	scan: { id: string; status: string; profile: string };
	runner?: "host" | "docker";
	profileOutcome: string;
	message?: string;
	toolResults: ScanStartToolResult[];
	stepResults?: ScanStartStepResult[];
}> {
	return requestJson(`/api/projects/${projectId}/scans`, {
		method: "POST",
		body: params,
	});
}

export async function preflightScan(
	projectId: string,
	params: {
		profile: string;
		stepId?: string;
		consentProjectCodeExecution?: boolean;
		runner?: "host" | "docker";
	},
): Promise<ScanPreflightResult & { executionPlan: ScanExecutionPlan }> {
	const data = await requestJson<{
		preflight: ScanPreflightResult;
		executionPlan: ScanExecutionPlan;
	}>(`/api/projects/${projectId}/scans/preflight`, {
		method: "POST",
		body: params,
	});
	return { ...data.preflight, executionPlan: data.executionPlan };
}

export async function previewScan(
	projectId: string,
	params: {
		profile: string;
		target: Exclude<ScanTarget, { kind: "full" }>;
	},
): Promise<DiffScanPreview> {
	return requestJson(`/api/projects/${projectId}/scans/preview`, {
		method: "POST",
		body: params,
	});
}

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
	return requestJson(`/api/scans/${scanRunId}/groups`);
}

export async function fetchScanGroupDetail(scanRunId: string, groupId: string) {
	return requestJson<{
		grouping: NonNullable<GroupedFindingsResult["grouping"]>;
		group: FindingGroup;
		members: Array<{
			finding: Finding;
			evidence: FindingEvidence[];
			provenance: Record<string, unknown> | null;
		}>;
	}>(`/api/scans/${scanRunId}/groups/${groupId}`);
}

export async function fetchScanAttackSurface(
	scanRunId: string,
): Promise<{ items: AttackSurfaceItem[] }> {
	return requestJson(`/api/scans/${scanRunId}/attack-surface`);
}

export async function runScanAttackSurfaceInventory(
	scanRunId: string,
): Promise<{
	ok: boolean;
	inventoryCount: number;
	categories: Record<string, number>;
}> {
	return requestJson(`/api/scans/${scanRunId}/attack-surface/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanSecurityChecks(
	scanRunId: string,
): Promise<{ results: SecurityCheckResult[] }> {
	return requestJson(`/api/scans/${scanRunId}/security-checks`);
}

export async function runScanSecurityChecks(scanRunId: string): Promise<{
	ok: boolean;
	resultCount: number;
	statusCounts: Record<string, number>;
}> {
	return requestJson(`/api/scans/${scanRunId}/security-checks/run`, {
		method: "POST",
		body: {},
	});
}

export async function fetchScanDiagnosticReports(
	scanRunId: string,
): Promise<{ reports: DiagnosticReport[] }> {
	return requestJson(`/api/scans/${scanRunId}/diagnostic-reports`);
}

export async function generateDiagnosticReport(scanRunId: string): Promise<{
	ok: boolean;
	reportId: string;
	artifactId: string | null;
	status: string;
	summary: string;
}> {
	return requestJson(`/api/scans/${scanRunId}/diagnostic-reports`, {
		method: "POST",
		body: { kind: "zero-finding" },
	});
}

export type { DiffScanPreview, ScanTarget, ScanTargetKind };
