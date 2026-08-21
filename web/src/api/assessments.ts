import { requestJson } from "./core";

export type ScanCoverageResultView = {
	id?: string;
	controlId: string;
	status:
		| "tested_passed"
		| "tested_failed"
		| "inconclusive"
		| "not_tested"
		| "blocked"
		| "unsupported";
	method: "automated" | "manual" | "unsupported";
	reasonCode: string;
	evidenceRefs: Array<{ kind: string; id: string }>;
	snapshotHash?: string;
	control: {
		framework: string;
		version: string;
		label: string;
		category: string;
		officialUrl: string;
		automationLevel: "full" | "partial";
		limitations: string[];
	} | null;
};

export type AssessmentEngagement = {
	id: string;
	projectId: string;
	purpose: "internal" | "external";
	environment: "local" | "ephemeral" | "staging" | "production";
	status: "draft" | "active" | "completed" | "expired" | "revoked";
	scope: {
		origins: string[];
		paths: string[];
		methods: string[];
	};
	rulesOfEngagement: Record<string, unknown> | null;
	startsAt: string;
	expiresAt: string;
};

export async function fetchProjectAssessments(
	projectId: string,
): Promise<AssessmentEngagement[]> {
	const result = await requestJson<{ engagements: AssessmentEngagement[] }>(
		`/api/projects/${encodeURIComponent(projectId)}/assessments`,
	);
	return result.engagements;
}

export async function triggerActiveAssessment(
	projectId: string,
	request: Record<string, unknown>,
): Promise<{ result: { scanRunId: string; activeAssessmentRunId: string } }> {
	return requestJson(
		`/api/projects/${encodeURIComponent(projectId)}/active-assessment-runs`,
		{ method: "POST", body: request },
	);
}
