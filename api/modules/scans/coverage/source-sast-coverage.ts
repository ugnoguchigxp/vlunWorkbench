import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import {
	type SourceSastCoverage,
	sourceSastCoverageSchema,
} from "../../../../shared/schemas/source-sast-coverage.schema";
import type { ScanProfileStepResult } from "../execution/profile-runner";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import {
	resolveSourceSastApplicability,
	type SourceSastApplicability,
} from "./source-sast-applicability";

export const SOURCE_SAST_NOT_EXECUTED = "source_sast_not_executed";

export function resolveSourceSastCoverage(
	profile: ScanProfile,
	results?: ScanProfileStepResult[],
	applicability?: SourceSastApplicability,
	registry = staticScannerAdapterRegistry,
): SourceSastCoverage | null {
	if (
		!["full-security-scan", "change-gate", "source-assurance"].includes(
			profile.id,
		)
	)
		return null;
	const sastSteps = (profile.steps ?? []).filter(
		(step) =>
			step.kind === "static_tool" &&
			registry.get(step.toolId)?.manifest.capabilities?.includes("source_sast"),
	);
	const sastStep =
		sastSteps.find(
			(step) =>
				step.kind === "static_tool" &&
				results?.some(
					(result) =>
						result.kind === "static_tool" &&
						result.toolId === step.toolId &&
						result.status === "completed",
				),
		) ?? sastSteps[0];
	if (sastStep?.kind !== "static_tool") {
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
	const manifest = registry.require(sastStep.toolId).manifest;
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
			stepId: sastStep.toolId,
			engine: manifest.id,
			rulesetId: manifest.sourceSastRulesetId ?? null,
			limitationCodes: resolvedApplicability.reasonCodes,
		};
	}
	if (resolvedApplicability.applicability === "unknown") {
		return {
			capability: "source_sast",
			applicability: "unknown",
			state: "unknown",
			coverageEffect: "gap",
			stepId: sastStep.toolId,
			engine: manifest.id,
			rulesetId: manifest.sourceSastRulesetId ?? null,
			limitationCodes: [],
		};
	}
	const result = results?.find(
		(candidate) =>
			candidate.kind === "static_tool" && candidate.toolId === sastStep.toolId,
	);
	const reasonCode = result?.kind === "static_tool" ? result.reasonCode : null;
	if (result?.status === "completed") {
		return {
			capability: "source_sast",
			applicability: "applicable",
			state: "executed",
			coverageEffect: "covered",
			stepId: sastStep.toolId,
			engine: manifest.id,
			rulesetId: manifest.sourceSastRulesetId ?? null,
			limitationCodes: [],
		};
	}
	return {
		capability: "source_sast",
		applicability: "applicable",
		state: "applicable",
		coverageEffect: "gap",
		stepId: sastStep.toolId,
		engine: manifest.id,
		rulesetId: manifest.sourceSastRulesetId ?? null,
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
