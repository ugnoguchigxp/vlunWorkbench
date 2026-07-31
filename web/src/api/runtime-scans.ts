import { requestJson } from "./core";

// --- Phase 11 DAST API types and functions ---

export type DastProfile = {
	id: "http-baseline" | "browser-smoke" | "form-baseline";
	displayName: string;
	description: string;
	kind: "http" | "browser" | "form";
	enabled: boolean;
	checks: string[];
	crawlerEnabled: false;
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
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
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
		runner?: "host" | "docker" | "mock";
		dockerImage?: string;
		timeoutSec?: number;
		maxRequests?: number;
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

export async function fetchDastRunArtifacts(
	dastRunId: string,
): Promise<{ artifacts: DastArtifact[]; evidence: DastEvidence[] }> {
	return requestJson<{ artifacts: DastArtifact[]; evidence: DastEvidence[] }>(
		`/api/dast-runs/${dastRunId}/artifacts`,
	);
}

// --- Phase 9 Sandbox Reproduction API types and functions ---

export type ReproductionProfile = {
	id: string;
	displayName: string;
	description: string;
	sourceTools: string[];
	defaultTimeoutSec: number;
	defaultNetworkMode: "none" | "default";
	isApplicable: boolean;
	applicabilityReason: string | null;
};

export type ReproductionRun = {
	id: string;
	projectId: string;
	scanRunId: string;
	findingId: string;
	profileId: string;
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome: "reproduced" | "not_reproduced" | "inconclusive" | "error" | null;
	runner: string;
	commandJson: string[] | null;
	exitCode: number | null;
	startedAt: string | null;
	completedAt: string | null;
	summary: string | null;
	errorMessage: string | null;
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ReproductionArtifact = {
	id: string;
	reproductionRunId: string;
	findingId: string;
	kind: "raw_result" | "stdout" | "stderr" | "log" | "summary";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type ReproductionEvidence = {
	id: string;
	reproductionRunId: string;
	findingId: string;
	kind: "reproduction-result" | "reproduction-log" | "tool-output";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export async function fetchReproductionProfiles(
	findingId: string,
): Promise<{ profiles: ReproductionProfile[] }> {
	return requestJson<{ profiles: ReproductionProfile[] }>(
		`/api/findings/${findingId}/reproduction-profiles`,
	);
}

export async function fetchFindingReproductions(
	findingId: string,
): Promise<{ reproductions: ReproductionRun[] }> {
	return requestJson<{ reproductions: ReproductionRun[] }>(
		`/api/findings/${findingId}/reproductions`,
	);
}

export async function triggerFindingReproduction(
	findingId: string,
	params: {
		profileId: string;
		runner?: "docker";
		dockerImage?: string;
		network?: "none" | "default";
		timeoutSec?: number;
		memory?: string;
		cpus?: string;
	},
): Promise<Record<string, unknown> & { reproductionRunId?: string }> {
	return requestJson<Record<string, unknown> & { reproductionRunId?: string }>(
		`/api/findings/${findingId}/reproductions`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function fetchReproductionRun(
	reproductionRunId: string,
): Promise<{ reproductionRun: ReproductionRun }> {
	return requestJson<{ reproductionRun: ReproductionRun }>(
		`/api/reproduction-runs/${reproductionRunId}`,
	);
}

export async function fetchReproductionRunArtifacts(
	reproductionRunId: string,
): Promise<{
	artifacts: ReproductionArtifact[];
	evidence: ReproductionEvidence[];
}> {
	return requestJson<{
		artifacts: ReproductionArtifact[];
		evidence: ReproductionEvidence[];
	}>(`/api/reproduction-runs/${reproductionRunId}/artifacts`);
}

export * from "./runtime-scans-dynamic";
