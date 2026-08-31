import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import type { SourceSastCoverage } from "../../../../shared/schemas/source-sast-coverage.schema";
import { readStoredScanPreflight } from "../execution/scan-preflight";
import { readCoverageLedger } from "./coverage-ledger";
import { readSourceSastCoverage } from "./source-sast-coverage";
import type { CoverageLedger } from "../../../../shared/schemas/scan-coverage-ledger.schema";
import {
	normalizedProfileStepResultSchema,
	type NormalizedProfileStepResult,
} from "../../../../shared/schemas/scan-profile-step-result.schema";

export type ScanCoverageControlResult = {
	controlId: string;
	status: string;
	method: string;
	reasonCode: string;
	evidenceRefs: ReadonlyArray<{ kind: string; id: string }>;
};

export type ScanCoverageReadModel = {
	ledger: CoverageLedger | null;
	normalizedStepResults: readonly NormalizedProfileStepResult[];
	sourceSast: SourceSastCoverage | null;
	preflight: ScanPreflightResult | null;
	controls: readonly ScanCoverageControlResult[];
};

export function buildScanCoverageReadModel(params: {
	scanMetadata?: Record<string, unknown> | null;
	controls: readonly ScanCoverageControlResult[];
}): ScanCoverageReadModel {
	return {
		ledger: readCoverageLedger(params.scanMetadata),
		normalizedStepResults: readNormalizedStepResults(params.scanMetadata),
		sourceSast: readSourceSastCoverage(params.scanMetadata),
		preflight: readStoredScanPreflight(params.scanMetadata),
		controls: params.controls,
	};
}

function readNormalizedStepResults(
	metadata: Record<string, unknown> | null | undefined,
): readonly NormalizedProfileStepResult[] {
	const value = metadata?.normalizedStepResults;
	if (!Array.isArray(value)) return [];
	const parsed = normalizedProfileStepResultSchema.array().safeParse(value);
	return parsed.success ? parsed.data : [];
}

export function sourceSastLooksCovered(model: ScanCoverageReadModel): boolean {
	return model.sourceSast?.coverageEffect === "covered";
}
