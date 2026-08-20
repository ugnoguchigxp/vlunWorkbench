import type { ScanExecutionPlan } from "../../../shared/schemas/scan-execution-plan.schema";
import { scanExecutionPlanSchema } from "../../../shared/schemas/scan-execution-plan.schema";
import type { ScanPreflightResult } from "../../../shared/schemas/scan-preflight.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../shared/schemas/scan-profile.schema";
import { canonicalJson } from "./diff-scan-plan";
import { hashPreflightValue } from "./scan-preflight-binding";

export function scanProfileStepId(step: ScanProfileStep): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? `dast:${step.profileId}`
			: `${step.kind}:${step.adapter}`;
}

function adapterForStep(step: ScanProfileStep): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? step.profileId
			: step.adapter;
}

/**
 * Compiles the immutable execution contract after preflight.  This is the
 * single source of truth for a scan's required/applicable decisions: callers
 * must not recompute those decisions while executing individual steps.
 */
export function buildScanExecutionPlan(params: {
	scanRunId: string;
	projectId: string;
	profile: ScanProfile;
	steps: ScanProfileStep[];
	preflight: ScanPreflightResult;
	qualificationHash?: string | null;
}): ScanExecutionPlan {
	const strictness = params.profile.strictness ?? "best_effort";
	const steps = params.steps.map((step) => {
		const stepId = scanProfileStepId(step);
		const checks = params.preflight.checks.filter(
			(check) => check.stepId === stepId,
		);
		const notApplicable = checks.some(
			(check) => check.status === "not_applicable",
		);
		const blocked = checks.some((check) => check.status === "blocked");
		const required = strictness === "strict" ? !notApplicable : step.required;
		return {
			stepId,
			kind: step.kind,
			adapter: adapterForStep(step),
			required,
			applicability: notApplicable
				? ("not_applicable" as const)
				: checks.length === 0
					? ("unknown" as const)
					: ("applicable" as const),
			readiness: blocked
				? ("blocked" as const)
				: checks.length === 0
					? ("unchecked" as const)
					: ("ready" as const),
			requirement: required
				? ("required_if_applicable" as const)
				: ("advisory" as const),
			reasonCodes: [
				...new Set(checks.flatMap((check) => check.reasonCode ?? [])),
			].sort(),
			evidenceRefs: [
				...new Set(checks.flatMap((check) => check.evidenceRefs)),
			].sort(),
		};
	});
	const unsigned = {
		schemaVersion: 1 as const,
		scanRunId: params.scanRunId,
		projectId: params.projectId,
		profileId: params.profile.id,
		strictness,
		preflightBindingHash: params.preflight.bindingHash,
		preflightHash: params.preflight.preflightHash,
		qualificationHash:
			params.qualificationHash ??
			params.preflight.checks
				.find((check) => check.kind === "scanner_e2e_qualification")
				?.evidenceRefs.find((ref) =>
					ref.startsWith("scanner-e2e-qualification:"),
				)
				?.replace("scanner-e2e-qualification:", "") ??
			null,
		steps,
	};
	return scanExecutionPlanSchema.parse({
		...unsigned,
		planHash: hashPreflightValue(canonicalJson(unsigned)),
	});
}

export function applyExecutionPlanToSteps(
	steps: ScanProfileStep[],
	plan: ScanExecutionPlan,
): ScanProfileStep[] {
	const requirements = new Map(plan.steps.map((step) => [step.stepId, step]));
	return steps.map((step) => {
		const planned = requirements.get(scanProfileStepId(step));
		if (!planned) return step;
		return {
			...step,
			required: planned.required,
			failurePolicy: planned.required ? "fail_profile" : step.failurePolicy,
		};
	});
}

/** Apply strict requirements before preflight so blocked checks are required too. */
export function applyStrictProfileRequirements(
	profile: ScanProfile,
	steps: ScanProfileStep[],
): ScanProfileStep[] {
	if (profile.strictness !== "strict") return steps;
	return steps.map((step) => ({
		...step,
		required: true,
		failurePolicy: "fail_profile" as const,
	}));
}

export function executionPlanBlocks(plan: ScanExecutionPlan): boolean {
	return plan.steps.some(
		(step) =>
			step.required &&
			step.applicability === "applicable" &&
			step.readiness === "blocked",
	);
}
