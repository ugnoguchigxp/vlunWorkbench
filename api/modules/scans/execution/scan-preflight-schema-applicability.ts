import { SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanPreflightDependencies } from "./scan-preflight";

export type RepositorySchemaApplicability = {
	schemaPresent: boolean;
	apiDetected: boolean;
	evidenceRefs: string[];
	reasonCode: string | null;
};

export function normalizeRepositorySchemaApplicability(
	discovered: Awaited<
		ReturnType<ScanPreflightDependencies["discoverRepositorySchema"]>
	>,
): RepositorySchemaApplicability {
	return typeof discovered === "boolean"
		? {
				schemaPresent: discovered,
				apiDetected: false,
				evidenceRefs: [],
				reasonCode: discovered ? null : "schema_not_found",
			}
		: {
				schemaPresent: discovered.schemaPresent,
				apiDetected: discovered.apiDetected,
				reasonCode: discovered.reasonCode ?? null,
				evidenceRefs: (discovered.evidenceRefs ?? []).slice(
					0,
					SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT,
				),
			};
}
