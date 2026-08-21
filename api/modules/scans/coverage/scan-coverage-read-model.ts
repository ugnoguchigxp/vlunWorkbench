import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import type { SourceSastCoverage } from "../../../../shared/schemas/source-sast-coverage.schema";
import { readStoredScanPreflight } from "../scan-preflight";
import { readSourceSastCoverage } from "./source-sast-coverage";

export type ScanCoverageControlResult = {
	controlId: string;
	status: string;
	method: string;
	reasonCode: string;
	evidenceRefs: ReadonlyArray<{ kind: string; id: string }>;
};

export type ScanCoverageReadModel = {
	sourceSast: SourceSastCoverage | null;
	preflight: ScanPreflightResult | null;
	controls: readonly ScanCoverageControlResult[];
};

export function buildScanCoverageReadModel(params: {
	scanMetadata?: Record<string, unknown> | null;
	controls: readonly ScanCoverageControlResult[];
}): ScanCoverageReadModel {
	return {
		sourceSast: readSourceSastCoverage(params.scanMetadata),
		preflight: readStoredScanPreflight(params.scanMetadata),
		controls: params.controls,
	};
}

export function sourceSastLooksCovered(model: ScanCoverageReadModel): boolean {
	return model.sourceSast?.coverageEffect === "covered";
}
