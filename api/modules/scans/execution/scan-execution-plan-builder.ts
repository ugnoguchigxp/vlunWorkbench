import type {
	ScanExecutionPlan,
	ScanExecutionPlanV3,
} from "../../../../shared/schemas/scan-execution-plan.schema";
import { scanExecutionPlanSchema } from "../../../../shared/schemas/scan-execution-plan.schema";
import type { ScanPreflightResult } from "../../../../shared/schemas/scan-preflight.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import { canonicalJson } from "./diff/diff-scan-plan";
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

function uniqueSorted(values: Array<string | null | undefined>): string[] {
	return [
		...new Set(values.filter((value): value is string => Boolean(value))),
	].sort();
}

/**
 * Compile the immutable execution contract after preflight. Execution must use
 * this plan instead of recomputing required/applicable decisions per step.
 */
export function buildScanExecutionPlan(params: {
	scanRunId: string;
	projectId: string;
	profile: ScanProfile;
	steps: ScanProfileStep[];
	preflight: ScanPreflightResult;
	qualificationHash?: string | null;
	technologyRegistryDigest?: string | null;
	sourceSnapshotDigest?: string | null;
	runner?: "host" | "docker";
	schemaVersion?: 1 | 2 | 3;
	runtimeIsolation?: ScanExecutionPlanV3["runtimeIsolation"];
}): ScanExecutionPlan {
	const schemaVersion = params.schemaVersion ?? 1;
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
			reasonCodes: uniqueSorted(checks.map((check) => check.reasonCode)),
			evidenceRefs: uniqueSorted(checks.flatMap((check) => check.evidenceRefs)),
		};
	});

	const blockerCodes = uniqueSorted(
		params.preflight.checks
			.filter((check) => check.required && check.status === "blocked")
			.map((check) => check.reasonCode),
	);
	const warningCodes = uniqueSorted(
		params.preflight.limitationCodes.filter(
			(code) => !blockerCodes.includes(code),
		),
	);
	const qualificationHash =
		params.qualificationHash ??
		params.preflight.checks
			.find((check) => check.kind === "scanner_e2e_qualification")
			?.evidenceRefs.find((ref) => ref.startsWith("scanner-e2e-qualification:"))
			?.replace("scanner-e2e-qualification:", "") ??
		null;

	const contract = {
		projectId: params.projectId,
		profileId: params.profile.id,
		profileVersion: 1,
		strictness,
		sourceRevision: params.preflight.sourceRevision,
		sourceRevisionHash: params.preflight.binding.sourceRevisionHash,
		sourceSnapshotDigest: params.sourceSnapshotDigest ?? null,
		sourceState: params.preflight.sourceState,
		resolvedProfileHash: params.preflight.binding.resolvedProfileHash,
		scannerManifestHash: params.preflight.binding.scannerManifestHash,
		scannerVersionsHash: params.preflight.binding.scannerVersionsHash,
		dockerImagesHash: params.preflight.binding.dockerImagesHash,
		targetPlanHash: params.preflight.binding.targetPlanHash,
		technologyRegistryDigest: params.technologyRegistryDigest ?? null,
		orchestrator: {
			id: "profile-orchestrator" as const,
			version: 1 as const,
			runner: params.runner ?? ("host" as const),
		},
		preflightBindingHash: params.preflight.bindingHash,
		qualificationHash,
		blockerCodes,
		warningCodes,
		steps,
	};
	const versionedContract =
		schemaVersion === 2 || schemaVersion === 3
			? {
					...contract,
					schemaVersion: 2 as const,
					capabilityRequirements: params.profile.capabilityRequirements ?? [],
					safety: {
						networkPolicy:
							(params.runner ?? "host") === "docker"
								? ("isolated" as const)
								: ("allowlisted" as const),
						approvalRequired: false,
						approvalRef: null,
					},
					steps: steps.map((planned, index) => {
						const sourceStep = params.steps[index];
						const options = (
							"options" in sourceStep ? sourceStep.options : undefined
						) as { maxRequests?: number } | undefined;
						return {
							...planned,
							inputBindingHash: hashPreflightValue(
								canonicalJson({
									stepId: planned.stepId,
									applicability: planned.applicability,
									readiness: planned.readiness,
									evidenceRefs: planned.evidenceRefs,
								}),
							),
							policyHash: hashPreflightValue(
								canonicalJson({
									required: planned.required,
									requirement: planned.requirement,
									runner: params.runner ?? "host",
								}),
							),
							budget: {
								timeoutSec:
									sourceStep.timeoutSec ?? params.profile.defaultTimeoutSec,
								maxRequests: options?.maxRequests ?? null,
							},
							cleanupRequirement: [
								"dast",
								"runtime_scanner",
								"api_schema_scan",
							].includes(planned.kind)
								? ("required" as const)
								: ("not_required" as const),
						};
					}),
				}
			: { ...contract, schemaVersion: 1 as const };
	if (schemaVersion === 3) {
		if (!params.runtimeIsolation) {
			throw new Error("runtime_isolation_plan_required");
		}
		Object.assign(versionedContract, {
			schemaVersion: 3 as const,
			runtimeIsolation: params.runtimeIsolation,
		});
	}

	// Run identity and timestamps are audit attributes, not contract inputs. A
	// preview and the subsequently created run must therefore produce one hash.
	const planHash = hashPreflightValue(canonicalJson(versionedContract));
	return scanExecutionPlanSchema.parse({
		...versionedContract,
		scanRunId: params.scanRunId,
		createdAt: params.preflight.createdAt,
		preflightHash: params.preflight.preflightHash,
		planHash,
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

/** Apply strict requirements before preflight so blocked checks are required. */
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
			(step.applicability === "unknown" ||
				(step.applicability === "applicable" && step.readiness !== "ready")),
	);
}

export function readStoredScanExecutionPlan(
	metadata: unknown,
): ScanExecutionPlan | null {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		return null;
	}
	const parsed = scanExecutionPlanSchema.safeParse(
		(metadata as Record<string, unknown>).executionPlan,
	);
	return parsed.success ? parsed.data : null;
}
