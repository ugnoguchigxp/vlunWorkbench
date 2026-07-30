import { requestJson } from "./core";

export type ThreatModelRunSummary = {
	id: string;
	projectId: string;
	modelSnapshotId: string;
	status: string;
	llmAvailable: boolean;
	limitations: string[];
	errorCode: string | null;
	createdAt: string;
	completedAt: string | null;
	current: boolean;
};

export type ThreatModelRunDetail = {
	run: ThreatModelRunSummary;
	snapshot: {
		snapshotHash: string;
		sourceFingerprint: string;
		model: {
			entrypoints: unknown[];
			actors: unknown[];
			assets: unknown[];
			unresolvedSuggestions: unknown[];
		};
	} | null;
	hypotheses: Array<{
		id: string;
		externalId: string;
		category: string;
		status: string;
		validationKind: string;
	}>;
	evidence: Array<{ id: string; kind: string; reference: string }>;
};

export type BusinessLogicScenarioSummary = {
	id: string;
	controlId: string;
	planHash: string;
	createdAt: string;
};

export type ActiveAssessmentRunSummary = {
	id: string;
	kind: "transaction" | "authorization_matrix" | "zap_active";
	status: string;
	requestCount: number;
	findingCount: number;
	cleanupSucceeded?: boolean;
	createdAt: string;
};

export async function fetchThreatModelRuns(
	projectId: string,
): Promise<ThreatModelRunSummary[]> {
	const result = await requestJson<{ runs: ThreatModelRunSummary[] }>(
		`/api/projects/${encodeURIComponent(projectId)}/threat-model-runs`,
	);
	return result.runs;
}

export async function createThreatModelRun(
	projectId: string,
): Promise<ThreatModelRunDetail> {
	return requestJson<ThreatModelRunDetail>(
		`/api/projects/${encodeURIComponent(projectId)}/threat-model-runs`,
		{ method: "POST", body: {} },
	);
}

export async function fetchThreatModelRun(
	runId: string,
): Promise<ThreatModelRunDetail> {
	return requestJson<ThreatModelRunDetail>(
		`/api/threat-model-runs/${encodeURIComponent(runId)}`,
	);
}

export async function fetchBusinessLogicScenarios(
	projectId: string,
): Promise<BusinessLogicScenarioSummary[]> {
	const result = await requestJson<{
		scenarios: BusinessLogicScenarioSummary[];
	}>(`/api/projects/${encodeURIComponent(projectId)}/business-logic-scenarios`);
	return result.scenarios;
}

export async function fetchActiveAssessmentRuns(
	projectId: string,
): Promise<ActiveAssessmentRunSummary[]> {
	const result = await requestJson<{ runs: ActiveAssessmentRunSummary[] }>(
		`/api/projects/${encodeURIComponent(projectId)}/active-assessment-runs`,
	);
	return result.runs;
}
