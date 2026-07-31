import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../shared/schemas/scan-profile.schema";
import { SECURITY_CAPABILITY_DEFAULTS } from "../../config/appDefaults";

export const RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET = 250;

export function applyDastStandardRollout(profile: ScanProfile): ScanProfile {
	const enabled =
		SECURITY_CAPABILITY_DEFAULTS.dastStandardV2Enabled &&
		SECURITY_CAPABILITY_DEFAULTS.dastStandardV2Default;
	if (enabled) return profile;
	return {
		...profile,
		steps: profile.steps?.map((step) =>
			step.kind === "dast" && step.profileId === "web-passive-standard"
				? {
						...step,
						profileId: "http-baseline" as const,
						displayName: "自動起動HTTP DAST smoke（rollback）",
						options: { maxRequests: 20 },
					}
				: step,
		),
	};
}

export function plannedRuntimeAssessmentRequests(profile: ScanProfile): number {
	return (profile.steps ?? staticSteps(profile)).reduce((total, step) => {
		if (step.kind === "dast") {
			return (
				total +
				Number(
					step.options?.aggregateRequestBudget ??
						step.options?.maxRequests ??
						0,
				)
			);
		}
		if (step.kind === "runtime_scanner") {
			const options = step.options as { maxRequests?: number } | undefined;
			return total + Number(options?.maxRequests ?? 0);
		}
		if (step.kind === "api_schema_scan") {
			const options = step.options as { maxRequests?: number } | undefined;
			return total + Number(options?.maxRequests ?? 0);
		}
		return total;
	}, 0);
}

export function assertRuntimeAssessmentBudget(profile: ScanProfile): void {
	const planned = plannedRuntimeAssessmentRequests(profile);
	if (planned > RUNTIME_ASSESSMENT_AGGREGATE_REQUEST_BUDGET) {
		throw new Error(
			`runtime_assessment_budget_exceeded:${profile.id}:${planned}`,
		);
	}
}

function staticSteps(profile: Pick<ScanProfile, "tools">): ScanProfileStep[] {
	return profile.tools.map((tool) => ({ kind: "static_tool", ...tool }));
}
