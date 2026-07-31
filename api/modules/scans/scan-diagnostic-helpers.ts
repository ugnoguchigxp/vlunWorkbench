import crypto from "node:crypto";
import type {
	AutomatedDiagnosticReadiness,
	AutomatedDiagnosticStatus,
} from "../../../shared/schemas/automated-diagnostic.schema";
import { canonicalJson } from "./diff-scan-plan";
import type { ScanReviewBundle } from "./scan-review-bundle";

export type DiagnosticJobResult = {
	diagnosticRunId: string;
	status: Extract<
		AutomatedDiagnosticStatus,
		"completed" | "completed_with_limitations" | "failed"
	>;
	readiness: AutomatedDiagnosticReadiness;
	reviewId: string | null;
	reportId: string | null;
	limitations: string[];
	error?: string;
};

export function buildDiagnosticSnapshotHashes(bundle: ScanReviewBundle): {
	inputSnapshotHash: string;
	scannerProvenanceHash: string;
} {
	const serializableBundle = JSON.parse(JSON.stringify(bundle));
	const inputSnapshotHash = sha256(canonicalJson(serializableBundle));
	const scannerProvenanceHash = sha256(
		canonicalJson({
			scanRun: serializableBundle.scanRun,
			tools: serializableBundle.tools,
			artifacts: serializableBundle.artifacts,
		}),
	);
	return { inputSnapshotHash, scannerProvenanceHash };
}

export function isTerminalDiagnosticStatus(status: string): boolean {
	return (
		status === "completed" ||
		status === "completed_with_limitations" ||
		status === "failed"
	);
}

export function diagnosticResultFromRow(row: {
	id: string;
	status: string;
	readiness: string | null;
	scanReviewId: string | null;
	scanReportId: string | null;
	limitationCodes: string[];
	errorMessage: string | null;
}): DiagnosticJobResult {
	return {
		diagnosticRunId: row.id,
		status: (isTerminalDiagnosticStatus(row.status) ? row.status : "failed") as
			| "completed"
			| "completed_with_limitations"
			| "failed",
		readiness: (row.readiness ?? "failed") as AutomatedDiagnosticReadiness,
		reviewId: row.scanReviewId,
		reportId: row.scanReportId,
		limitations: row.limitationCodes,
		...(row.errorMessage ? { error: row.errorMessage } : {}),
	};
}

export function classifyReviewLimitation(error: string | undefined): string {
	if (
		error?.includes("not_configured") ||
		error?.includes("provider_not_found") ||
		error?.includes("provider is not configured")
	) {
		return "llm_unavailable";
	}
	if (error?.includes("llm_structured_output_validation_failed")) {
		return "llm_invalid_output";
	}
	return "llm_failed";
}

export function collectBundleLimitations(bundle: ScanReviewBundle): string[] {
	const limitations: string[] = [];
	if (bundle.limits.includedFindings < bundle.limits.totalFindings) {
		limitations.push("finding_bundle_truncated");
	}
	const toolProvenance = bundle.tools.map((tool) => tool.provenance);
	if (toolProvenance.some((item) => item.reproducible === false)) {
		limitations.push("scanner_input_non_reproducible");
	}
	if (toolProvenance.some((item) => item.dataState === "stale")) {
		limitations.push("scanner_data_stale");
	}
	if (toolProvenance.some((item) => item.dataState === "missing")) {
		limitations.push("scanner_data_missing");
	}
	const runtimeCoverage = asRecord(
		asRecord(bundle.scanRun.metadata)?.runtimeAssessmentCoverage,
	);
	const runtimeSteps = Array.isArray(runtimeCoverage?.steps)
		? runtimeCoverage.steps
		: [];
	if (
		runtimeSteps.length > 0 &&
		runtimeCoverage?.coverageStatus !== "covered"
	) {
		limitations.push(
			runtimeCoverage?.coverageStatus === "gap"
				? "runtime_assessment_coverage_gap"
				: "runtime_assessment_coverage_partial",
		);
	}
	for (const code of Array.isArray(runtimeCoverage?.limitationCodes)
		? runtimeCoverage.limitationCodes
		: []) {
		if (typeof code === "string" && code.length > 0) {
			limitations.push(`runtime:${code}`);
		}
	}
	return [...new Set(limitations)].sort();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function logDiagnosticFailure(
	event: string,
	error: unknown,
	scanRunId: string,
): void {
	console.error(
		JSON.stringify({
			version: 1,
			level: "error",
			event: `automated_diagnostic_${event}`,
			scanRunId,
			errorName: error instanceof Error ? error.name : "UnknownError",
		}),
	);
}

function sha256(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}
