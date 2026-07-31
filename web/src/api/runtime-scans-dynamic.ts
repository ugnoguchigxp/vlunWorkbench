import { requestJson } from "./core";

export type DynamicProfileConfig = {
	id: string;
	projectId: string;
	profileId: string;
	dynamicKind: "test" | "sanitizer" | "fuzz";
	displayName: string;
	enabled: boolean;
	commandJson: string[];
	workingDirectory: string;
	timeoutSec: number;
	network: string;
	memory: string | null;
	cpus: string | null;
	writableWorkdir: boolean;
	allowProjectScripts: boolean;
	expectedArtifactsJson: string[];
	metadata: Record<string, unknown>;
	createdByUserId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DynamicRun = {
	id: string;
	projectId: string;
	scanRunId: string | null;
	findingId: string | null;
	profileConfigId: string;
	profileId: string;
	dynamicKind: "test" | "sanitizer" | "fuzz";
	status:
		| "queued"
		| "running"
		| "completed"
		| "failed"
		| "timed_out"
		| "cancelled";
	outcome:
		| "passed"
		| "failed"
		| "crashed"
		| "timed_out"
		| "inconclusive"
		| "error"
		| null;
	runner: string;
	commandJson: string[];
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

export type DynamicArtifact = {
	id: string;
	dynamicRunId: string;
	projectId: string;
	findingId: string | null;
	kind:
		| "stdout"
		| "stderr"
		| "log"
		| "crash"
		| "summary"
		| "coverage"
		| "raw_result";
	format: string;
	path: string;
	sha256: string;
	sizeBytes: number;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export type DynamicEvidence = {
	id: string;
	dynamicRunId: string;
	projectId: string;
	findingId: string | null;
	kind:
		| "dynamic-test-log"
		| "sanitizer-finding"
		| "fuzz-crash"
		| "dynamic-result";
	title: string;
	artifactId: string | null;
	location: Record<string, unknown> | null;
	snippet: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
};

export async function fetchProjectDynamicProfiles(
	projectId: string,
): Promise<{ configs: DynamicProfileConfig[] }> {
	return requestJson<{ configs: DynamicProfileConfig[] }>(
		`/api/projects/${projectId}/dynamic-profiles`,
	);
}

export async function saveProjectDynamicProfile(
	projectId: string,
	params: Partial<DynamicProfileConfig> & {
		profileId: string;
		dynamicKind: string;
		displayName: string;
		commandJson: string[];
	},
): Promise<{ config: DynamicProfileConfig }> {
	return requestJson<{ config: DynamicProfileConfig }>(
		`/api/projects/${projectId}/dynamic-profiles`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function updateProjectDynamicProfile(
	projectId: string,
	profileId: string,
	params: Partial<DynamicProfileConfig>,
): Promise<{ config: DynamicProfileConfig }> {
	return requestJson<{ config: DynamicProfileConfig }>(
		`/api/projects/${projectId}/dynamic-profiles/${profileId}`,
		{
			method: "PATCH",
			body: params,
		},
	);
}

export async function fetchProjectDynamicRuns(
	projectId: string,
): Promise<{ dynamicRuns: DynamicRun[] }> {
	return requestJson<{ dynamicRuns: DynamicRun[] }>(
		`/api/projects/${projectId}/dynamic-runs`,
	);
}

export async function triggerProjectDynamicRun(
	projectId: string,
	params: {
		profileId: string;
		runner?: "docker";
		dockerImage?: string;
		network?: "none" | "default";
		timeoutSec?: number;
		memory?: string;
		cpus?: string;
	},
): Promise<Record<string, unknown> & { dynamicRunId?: string }> {
	return requestJson<Record<string, unknown> & { dynamicRunId?: string }>(
		`/api/projects/${projectId}/dynamic-runs`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function fetchFindingDynamicRuns(
	findingId: string,
): Promise<{ dynamicRuns: DynamicRun[] }> {
	return requestJson<{ dynamicRuns: DynamicRun[] }>(
		`/api/findings/${findingId}/dynamic-runs`,
	);
}

export async function triggerFindingDynamicRun(
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
): Promise<Record<string, unknown> & { dynamicRunId?: string }> {
	return requestJson<Record<string, unknown> & { dynamicRunId?: string }>(
		`/api/findings/${findingId}/dynamic-runs`,
		{
			method: "POST",
			body: params,
		},
	);
}

export async function fetchDynamicRun(
	dynamicRunId: string,
): Promise<{ dynamicRun: DynamicRun }> {
	return requestJson<{ dynamicRun: DynamicRun }>(
		`/api/dynamic-runs/${dynamicRunId}`,
	);
}

export async function fetchDynamicRunArtifacts(dynamicRunId: string): Promise<{
	artifacts: DynamicArtifact[];
	evidence: DynamicEvidence[];
}> {
	return requestJson<{
		artifacts: DynamicArtifact[];
		evidence: DynamicEvidence[];
	}>(`/api/dynamic-runs/${dynamicRunId}/artifacts`);
}
