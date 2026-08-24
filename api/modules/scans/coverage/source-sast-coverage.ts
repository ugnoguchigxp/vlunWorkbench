import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import {
	type SourceSastCoverage,
	sourceSastCoverageSchema,
} from "../../../../shared/schemas/source-sast-coverage.schema";
import type { ScanProfileStepResult } from "../execution/profile-runner";
import {
	resolveSourceSastApplicability,
	type SourceSastApplicability,
} from "./source-sast-applicability";

export const SOURCE_SAST_NOT_EXECUTED = "source_sast_not_executed";

export function resolveSourceSastCoverage(
	profile: ScanProfile,
	results?: ScanProfileStepResult[],
	applicability?: SourceSastApplicability,
): SourceSastCoverage | null {
	if (
		!["full-security-scan", "change-gate", "source-assurance"].includes(
			profile.id,
		)
	)
		return null;
	const semgrepStep = (profile.steps ?? []).find(
		(step) => step.kind === "static_tool" && step.toolId === "semgrep",
	);
	if (!semgrepStep) {
		return {
			capability: "source_sast",
			applicability: "applicable",
			state: "applicable",
			coverageEffect: "gap",
			stepId: null,
			engine: null,
			rulesetId: null,
			limitationCodes: [SOURCE_SAST_NOT_EXECUTED],
		};
	}
	const resolvedApplicability =
		applicability ??
		resolveSourceSastApplicability({
			hasSourceFiles: true,
			hasSupportedLanguage: true,
			rulesetAvailable: true,
			adapterAvailable: true,
		});
	if (resolvedApplicability.applicability === "not_applicable") {
		return {
			capability: "source_sast",
			applicability: "not_applicable",
			state: "not_applicable",
			coverageEffect: "covered",
			stepId: "semgrep",
			engine: "semgrep",
			rulesetId: "curated-sast-v1",
			limitationCodes: resolvedApplicability.reasonCodes,
		};
	}
	if (resolvedApplicability.applicability === "unknown") {
		return {
			capability: "source_sast",
			applicability: "unknown",
			state: "unknown",
			coverageEffect: "gap",
			stepId: "semgrep",
			engine: "semgrep",
			rulesetId: "curated-sast-v1",
			limitationCodes: [],
		};
	}
	const result = results?.find(
		(candidate) =>
			candidate.kind === "static_tool" && candidate.toolId === "semgrep",
	);
	const reasonCode = result?.kind === "static_tool" ? result.reasonCode : null;
	if (result?.status === "completed") {
		return {
			capability: "source_sast",
			applicability: "applicable",
			state: "executed",
			coverageEffect: "covered",
			stepId: "semgrep",
			engine: "semgrep",
			rulesetId: "curated-sast-v1",
			limitationCodes: [],
		};
	}
	return {
		capability: "source_sast",
		applicability: "applicable",
		state: "applicable",
		coverageEffect: "gap",
		stepId: "semgrep",
		engine: "semgrep",
		rulesetId: "curated-sast-v1",
		limitationCodes:
			results === undefined
				? [SOURCE_SAST_NOT_EXECUTED, ...resolvedApplicability.reasonCodes]
				: [
						SOURCE_SAST_NOT_EXECUTED,
						...resolvedApplicability.reasonCodes,
						...(reasonCode ? [reasonCode] : []),
					],
	};
}

export function readSourceSastCoverage(
	metadata: Record<string, unknown> | null | undefined,
): SourceSastCoverage | null {
	const parsed = sourceSastCoverageSchema.safeParse(
		metadata?.sourceSastCoverage,
	);
	return parsed.success ? parsed.data : null;
}
