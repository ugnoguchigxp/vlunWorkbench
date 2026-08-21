import { requestJson } from "./core";

// --- Phase 11 DAST API types and functions ---

export type DastProfile = {
	id:
		| "http-baseline"
		| "web-passive-standard"
		| "browser-smoke"
		| "authenticated-readonly"
		| "authenticated-readonly-standard"
		| "form-baseline";
	displayName: string;
	description: string;
	kind: "http" | "browser" | "form";
	enabled: boolean;
	checks: string[];
	crawlerEnabled: boolean;
	requiresAuth: boolean;
	requiresRoutes: boolean;
	requiresForms: boolean;
};

export type DastTargetConfig = {
	id: string;
	projectId: string;
	name: string;
	origin: string;
	normalizedOrigin: string;
	enabled: boolean;
	allowLoopback: boolean;
	allowPrivateNetwork: boolean;
	allowedPathsJson: string[];
	excludedPathsJson: string[];
	defaultHeadersJson: Record<string, string>;
	maxDepth: number;
	maxRequests: number;
	rateLimitPerSec: number;
	timeoutSec: number;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastProfileConfig = {
	id: string;
	projectId: string;
	targetConfigId: string;
	profileId: string;
	displayName: string;
	enabled: boolean;
	routePathsJson: string[];
	formSelectorsJson: string[];
	checkOptionsJson: Record<string, unknown>;
	timeoutSec: number | null;
	maxRequests: number | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastRun = {
	id: string;
	projectId: string;
	scanRunId: string;
	targetConfigId: string;
	profileConfigId: string | null;
	profileId: string;
	dastKind: "http" | "browser" | "form";
	targetOrigin: string;
	runnerOrigin: string;
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome:
		| "passed"
		| "findings"
		| "failed"
		| "timed_out"
		| "inconclusive"
		| "error"
		| null;
	verdict:
		| "findings"
		| "no_findings_observed"
		| "inconclusive"
		| "not_tested"
		| "unknown_legacy"
		| null;
	coverageStatus: "covered" | "partial" | "gap" | null;
	coverageSummary: DastCoverageSummary | Record<string, never>;
	limitationCodes: string[];
	policyId: string | null;
	policyHash: string | null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DastCoverageSummary = {
	knownRouteCount: number;
	actionableKnownRouteCount: number;
	plannedRouteCount: number;
	attemptedRouteCount: number;
	successfulRouteCount: number;
	failedRouteCount: number;
	blockedRouteCount: number;
	notTestedRouteCount: number;
	requiredSeedCoverage: number;
	actionableRouteCoverage: number;
	requestCount: number;
	responseBytesRead: number;
	maxDepthReached: number;
	transportErrorCount: number;
	timeoutCount: number;
	authFailureCount: number;
	budgetExhausted: boolean;
	limitationCodes: string[];
};

export type DastRouteInventoryEntry = {
	id: string;
	dastRunId: string;
	method: "GET" | "HEAD" | "OPTIONS";
	path: string;
	queryKeys: string[];
	sources: string[];
	depth: number;
	required: boolean;
	authMode: "anonymous" | "authenticated";
	state: string;
	statusCode: number | null;
	limitationCode: string | null;
};

export type DastAuthContext = {
	id: string;
	projectId: string;
	targetConfigId: string;
	identityRole: string;
	label: string;
	authKind: string;
	loginFlow: Array<Record<string, unknown>>;
	successAssertions: Array<Record<string, unknown>>;
	status: "active" | "revoked";
	expiresAt: string;
	createdAt: string;
	updatedAt: string;
};

export type DastArtifact = {
	id: string;
	dastRunId: string;
	projectId: string;
	scanRunId: string;
	kind:
		| "raw_result"
		| "http_log"
		| "browser_console"
		| "browser_network"
		| "screenshot"
		| "stdout"
		| "stderr"
		| "summary";
	format: "json" | "text" | "png" | "markdown";
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type DastEvidence = {
	id: string;
	dastRunId: string;
	projectId: string;
	scanRunId: string;
	findingId: string | null;
	kind:
		| "http-response"
		| "http-header"
		| "cookie-attribute"
		| "cors-policy"
		| "browser-console"
		| "browser-network"
		| "screenshot"
		| "dast-result";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type SaveDastTargetInput = {
	name: string;
	origin: string;
	enabled?: boolean;
	allowLoopback?: boolean;
	allowPrivateNetwork?: boolean;
	allowedPathsJson?: string[];
	excludedPathsJson?: string[];
	defaultHeadersJson?: Record<string, string>;
	maxDepth?: number;
	maxRequests?: number;
	rateLimitPerSec?: number;
	timeoutSec?: number;
	metadata?: Record<string, unknown>;
};

export type SaveDastProfileInput = {
	targetConfigId: string;
	profileId: string;
	displayName: string;
	enabled?: boolean;
	routePathsJson?: string[];
	formSelectorsJson?: string[];
	checkOptionsJson?: Record<string, unknown>;
	timeoutSec?: number | null;
	maxRequests?: number | null;
	metadata?: Record<string, unknown>;
};

export async function fetchProjectDastTargets(
	projectId: string,
): Promise<{ targets: DastTargetConfig[] }> {
	return requestJson<{ targets: DastTargetConfig[] }>(
		`/api/projects/${projectId}/dast-targets`,
	);
}

export async function saveProjectDastTarget(
	projectId: string,
	input: SaveDastTargetInput,
): Promise<{ target: DastTargetConfig; validation: unknown }> {
	return requestJson<{ target: DastTargetConfig; validation: unknown }>(
		`/api/projects/${projectId}/dast-targets`,
		{ method: "POST", body: input },
	);
}

export async function updateProjectDastTarget(
	projectId: string,
	targetConfigId: string,
	input: Partial<SaveDastTargetInput>,
): Promise<{ target: DastTargetConfig; validation: unknown }> {
	return requestJson<{ target: DastTargetConfig; validation: unknown }>(
		`/api/projects/${projectId}/dast-targets/${targetConfigId}`,
		{ method: "PATCH", body: input },
	);
}

export async function fetchProjectDastProfiles(
	projectId: string,
): Promise<{ profiles: DastProfile[]; configs: DastProfileConfig[] }> {
	return requestJson<{ profiles: DastProfile[]; configs: DastProfileConfig[] }>(
		`/api/projects/${projectId}/dast-profiles`,
	);
}

export async function saveProjectDastProfile(
	projectId: string,
	input: SaveDastProfileInput,
): Promise<{ config: DastProfileConfig }> {
	return requestJson<{ config: DastProfileConfig }>(
		`/api/projects/${projectId}/dast-profiles`,
		{ method: "POST", body: input },
	);
}

export async function fetchProjectDastRuns(
	projectId: string,
): Promise<{ dastRuns: DastRun[] }> {
	return requestJson<{ dastRuns: DastRun[] }>(
		`/api/projects/${projectId}/dast-runs`,
	);
}

export async function triggerProjectDastRun(
	projectId: string,
	input: {
		targetConfigId?: string;
		autoTarget?: boolean;
		profileId: string;
		profileConfigId?: string;
		scanRunId?: string;
		catalogProfileId?: "authenticated-web";
		runner?: "host" | "docker";
		dockerImage?: string;
		timeoutSec?: number;
		maxRequests?: number;
		authContextId?: string;
		identityRole?: string;
		dryRun?: boolean;
	},
): Promise<{
	ok: boolean;
	dastRunId: string | null;
	scanRunId: string | null;
	status: string;
	outcome: string | null;
	summary?: string;
	message?: string;
	plan?: {
		autoTarget?: {
			origin?: string;
			command?: string[];
			scriptName?: string;
			port?: number;
			warnings?: string[];
		};
	};
}> {
	return requestJson(`/api/projects/${projectId}/dast-runs`, {
		method: "POST",
		body: input,
	});
}

export async function fetchDastRunArtifacts(dastRunId: string): Promise<{
	artifacts: DastArtifact[];
	evidence: DastEvidence[];
	routeInventory: DastRouteInventoryEntry[];
}> {
	return requestJson<{
		artifacts: DastArtifact[];
		evidence: DastEvidence[];
		routeInventory: DastRouteInventoryEntry[];
	}>(`/api/dast-runs/${dastRunId}/artifacts`);
}

export async function fetchProjectDastAuthContexts(
	projectId: string,
): Promise<{ authContexts: DastAuthContext[] }> {
	return requestJson<{ authContexts: DastAuthContext[] }>(
		`/api/projects/${projectId}/dast-auth-contexts`,
	);
}

export async function createProjectDastAuthContext(
	projectId: string,
	input: {
		targetConfigId: string;
		identityRole: string;
		label: string;
		secret: Record<string, unknown>;
		loginFlow?: Array<Record<string, unknown>>;
		successAssertions?: Array<Record<string, unknown>>;
		expiresAt: string;
	},
): Promise<{ authContext: DastAuthContext }> {
	return requestJson<{ authContext: DastAuthContext }>(
		`/api/projects/${projectId}/dast-auth-contexts`,
		{ method: "POST", body: input },
	);
}

export async function rotateProjectDastAuthContext(
	projectId: string,
	authContextId: string,
	input: { secret: Record<string, unknown>; expiresAt: string },
): Promise<{ authContext: DastAuthContext }> {
	return requestJson<{ authContext: DastAuthContext }>(
		`/api/projects/${projectId}/dast-auth-contexts/${authContextId}/rotate`,
		{ method: "POST", body: input },
	);
}

export async function revokeProjectDastAuthContext(
	projectId: string,
	authContextId: string,
): Promise<{ authContext: DastAuthContext }> {
	return requestJson<{ authContext: DastAuthContext }>(
		`/api/projects/${projectId}/dast-auth-contexts/${authContextId}/revoke`,
		{ method: "POST" },
	);
}

export * from "./runtime-scans-dynamic";
export * from "./runtime-scans-reproduction";
