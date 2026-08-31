import { appendFileSync } from "node:fs";

export type ScannerE2EFailureObservation = {
	profileOutcome: "blocked" | "failed" | "incomplete" | "terminal";
	reasonCodes: string[];
	scannerProcessCount: number;
	toolRunCount: number;
	requestCount: number;
	artifactCount: number;
	canonicalFinalReportCount: number;
	terminalRowCount: number;
	cleanupCount: number;
	existingBytesUnchanged: boolean;
	covered: boolean;
	automaticDownloadCount: number;
};

/** Writes only during the dedicated scanner failure-evidence run. */
export function recordScannerE2EFailureObservation(
	caseId: string,
	observation: Pick<
		ScannerE2EFailureObservation,
		"profileOutcome" | "reasonCodes"
	> &
		Partial<ScannerE2EFailureObservation>,
): void {
	if (process.env.SCANNER_E2E_FAILURE_CASE_ID !== caseId) return;
	const outputPath = process.env.SCANNER_E2E_FAILURE_OBSERVATION_PATH;
	if (!outputPath) {
		throw new Error("scanner_e2e_failure_observation_path_missing");
	}
	const complete: ScannerE2EFailureObservation = {
		scannerProcessCount: 0,
		toolRunCount: 0,
		requestCount: 0,
		artifactCount: 0,
		canonicalFinalReportCount: 0,
		terminalRowCount: 1,
		cleanupCount: 0,
		existingBytesUnchanged: true,
		covered: false,
		automaticDownloadCount: 0,
		...observation,
	};
	appendFileSync(outputPath, `${JSON.stringify(complete)}\n`, {
		encoding: "utf8",
		flag: "a",
		mode: 0o600,
	});
}
