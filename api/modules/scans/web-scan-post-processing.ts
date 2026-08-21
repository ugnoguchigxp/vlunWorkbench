import type { FinalReportResult } from "./profile-runner";
import type { ScanRepository } from "./repositories";
import type { DiagnosticJobResult } from "./scan-diagnostic-helpers";
import { finalizeScanAfterDiagnostic } from "./scan-finalization-service";

type FinalReportRequest = {
	requested: boolean;
	title: string;
};

export async function runWebScanPostProcessing(params: {
	scanRunId: string;
	scanRepository: Pick<ScanRepository, "findById" | "createScanEvent">;
	diagnosticRunner: { run(scanRunId: string): Promise<DiagnosticJobResult> };
	finalize?: typeof finalizeScanAfterDiagnostic;
	db: Parameters<typeof finalizeScanAfterDiagnostic>[0]["db"];
}): Promise<void> {
	const diagnostic = await params.diagnosticRunner.run(params.scanRunId);
	await finalizeWebScanAfterDiagnostic({ ...params, diagnostic });
}

export async function finalizeWebScanAfterDiagnostic(params: {
	scanRunId: string;
	scanRepository: Pick<ScanRepository, "findById" | "createScanEvent">;
	diagnostic: DiagnosticJobResult;
	finalize?: typeof finalizeScanAfterDiagnostic;
	db: Parameters<typeof finalizeScanAfterDiagnostic>[0]["db"];
}): Promise<void> {
	const diagnostic = params.diagnostic;
	if (
		diagnostic.status !== "completed" &&
		diagnostic.status !== "completed_with_limitations"
	) {
		return;
	}
	const scan = await params.scanRepository.findById(params.scanRunId);
	const request = readFinalReportRequest(scan?.metadata);
	if (!request.requested) return;

	const finalize = params.finalize ?? finalizeScanAfterDiagnostic;
	const result = await finalize({
		db: params.db,
		scanRunId: params.scanRunId,
		options: {
			enabled: true,
			title: request.title,
			includeFalsePositives: true,
			includeDeferred: true,
			includeUndecided: true,
		},
	});
	if (result.ok) return;
	if (
		result.status === "skipped" &&
		(result.error === "canonical_final_report_in_progress" ||
			result.error === "canonical_final_report_claim_lost")
	) {
		return;
	}
	await recordFinalizationFailure(params, result);
}

function readFinalReportRequest(metadata: unknown): FinalReportRequest {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return { requested: false, title: "最終セキュリティレポート" };
	}
	const value = (metadata as Record<string, unknown>).finalReportRequest;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { requested: false, title: "最終セキュリティレポート" };
	}
	const request = value as Record<string, unknown>;
	return {
		requested: request.requested === true,
		title:
			typeof request.title === "string" && request.title.trim()
				? request.title.trim()
				: "最終セキュリティレポート",
	};
}

async function recordFinalizationFailure(
	params: {
		scanRunId: string;
		scanRepository: Pick<ScanRepository, "createScanEvent">;
	},
	result: FinalReportResult,
): Promise<void> {
	await params.scanRepository.createScanEvent({
		scanRunId: params.scanRunId,
		level: "error",
		eventType: "report.finalization_failed",
		message: "Canonical final report generation did not complete.",
		data: { status: result.status, error: result.error },
	});
}
