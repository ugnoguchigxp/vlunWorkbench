import { requestJson } from "./core";

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
): Promise<
	Record<string, unknown> & { reproductionRunId?: string; scanRunId?: string }
> {
	return requestJson<
		Record<string, unknown> & { reproductionRunId?: string; scanRunId?: string }
	>(`/api/findings/${findingId}/reproductions`, {
		method: "POST",
		body: params,
	});
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
