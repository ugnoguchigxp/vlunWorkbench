import { requestJson } from "./core";

export type AutomatedDiagnosticRun = {
	id: string;
	scanRunId: string;
	inputSnapshotHash: string;
	scannerProvenanceHash: string;
	pipelineVersion: string;
	status:
		| "queued"
		| "running"
		| "completed"
		| "completed_with_limitations"
		| "failed";
	readiness: "ready" | "ready_with_limitations" | "failed" | null;
	scanReviewId: string | null;
	scanReportId: string | null;
	limitationCodes: string[];
	errorMessage: string | null;
	attemptCount: number;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

export async function fetchAutomatedScanDiagnostics(
	scanRunId: string,
): Promise<AutomatedDiagnosticRun[]> {
	const data = await requestJson<{ diagnostics: AutomatedDiagnosticRun[] }>(
		`/api/scans/${scanRunId}/diagnostics`,
	);
	return [...data.diagnostics].sort(
		(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
	);
}

export async function retryAutomatedScanDiagnostic(
	scanRunId: string,
): Promise<{ diagnostic: AutomatedDiagnosticRun }> {
	return requestJson<{ diagnostic: AutomatedDiagnosticRun }>(
		`/api/scans/${scanRunId}/diagnostics/retry`,
		{ method: "POST" },
	);
}
