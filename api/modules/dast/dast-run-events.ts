import type { ScanRepository } from "../scans/repositories";
import type { DastNormalizerResult, DastRawResult } from "./types";

export async function emitDastAssessmentEvents(params: {
	scanRepository: ScanRepository;
	scanRunId: string;
	dastRunId: string;
	profileId: string;
	requiresAuth: boolean;
	result: DastRawResult;
	normalized: DastNormalizerResult;
}): Promise<void> {
	const {
		scanRepository,
		scanRunId,
		dastRunId,
		profileId,
		requiresAuth,
		result,
		normalized,
	} = params;
	await scanRepository.createScanEvent({
		scanRunId,
		level: "info",
		eventType: "dast.discovery.completed",
		message: `${result.routeInventory.length} known route(s) recorded.`,
		data: {
			dastRunId,
			knownRouteCount: result.routeInventory.length,
			attemptedRouteCount: normalized.coverageSummary.attemptedRouteCount,
			sourceCounts: countRouteSources(result),
		},
	});
	if (requiresAuth && normalized.coverageSummary.authFailureCount === 0) {
		await scanRepository.createScanEvent({
			scanRunId,
			level: "info",
			eventType: "dast.auth.preflight_succeeded",
			message: "Authenticated DAST preflight assertions succeeded.",
			data: { dastRunId, profileId },
		});
	}
	if (normalized.coverageSummary.budgetExhausted) {
		await scanRepository.createScanEvent({
			scanRunId,
			level: "warn",
			eventType: "dast.budget.exhausted",
			message: "DAST request or response budget was exhausted.",
			data: {
				dastRunId,
				requestCount: normalized.coverageSummary.requestCount,
				limitationCodes: normalized.limitationCodes,
			},
		});
	}
	if (normalized.coverageStatus !== "covered") {
		await scanRepository.createScanEvent({
			scanRunId,
			level: "warn",
			eventType: "dast.coverage.partial",
			message: `DAST coverage finalized as ${normalized.coverageStatus}.`,
			data: {
				dastRunId,
				coverageStatus: normalized.coverageStatus,
				limitationCodes: normalized.limitationCodes,
			},
		});
	}
	await scanRepository.createScanEvent({
		scanRunId,
		level: "info",
		eventType: "dast.verdict.finalized",
		message: `DAST verdict finalized as ${normalized.verdict}.`,
		data: {
			dastRunId,
			verdict: normalized.verdict,
			coverageStatus: normalized.coverageStatus,
		},
	});
}

function countRouteSources(result: DastRawResult): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of result.routeInventory) {
		for (const source of entry.sources) {
			counts[source] = (counts[source] ?? 0) + 1;
		}
	}
	return counts;
}
