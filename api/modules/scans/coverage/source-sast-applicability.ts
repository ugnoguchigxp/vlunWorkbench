import type { ScanCapabilityApplicability } from "../../../../shared/schemas/scan-capability.schema";
import type { ScanReasonCode } from "../../../../shared/schemas/scan-reason-code.schema";

export type SourceSastApplicability = {
	applicability: ScanCapabilityApplicability;
	reasonCodes: ScanReasonCode[];
};

/**
 * Decide Source SAST applicability from four independently observable inputs.
 * A missing engine/ruleset is a readiness gap, never a fabricated N/A.
 */
export function resolveSourceSastApplicability(params: {
	hasSourceFiles: boolean | "unknown";
	hasSupportedLanguage: boolean | "unknown";
	rulesetAvailable: boolean | "unknown";
	adapterAvailable: boolean | "unknown";
}): SourceSastApplicability {
	if (
		params.hasSourceFiles === false ||
		params.hasSupportedLanguage === false
	) {
		return {
			applicability: "not_applicable",
			reasonCodes: ["source_sast_no_supported_files"],
		};
	}
	if (
		params.hasSourceFiles === "unknown" ||
		params.hasSupportedLanguage === "unknown"
	) {
		return { applicability: "unknown", reasonCodes: [] };
	}
	if (params.rulesetAvailable === false) {
		return {
			applicability: "applicable",
			reasonCodes: ["source_sast_ruleset_unavailable"],
		};
	}
	if (params.adapterAvailable === false) {
		return {
			applicability: "applicable",
			reasonCodes: ["source_sast_adapter_unavailable"],
		};
	}
	if (
		params.rulesetAvailable === "unknown" ||
		params.adapterAvailable === "unknown"
	) {
		return { applicability: "unknown", reasonCodes: [] };
	}
	return { applicability: "applicable", reasonCodes: [] };
}
