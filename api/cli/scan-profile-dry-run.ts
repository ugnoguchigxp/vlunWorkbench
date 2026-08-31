import type { ScanExecutionPlan } from "../../shared/schemas/scan-execution-plan.schema";
import type { ScanPreflightResult } from "../../shared/schemas/scan-preflight.schema";
import type { ScanProfile } from "../../shared/schemas/scan-profile.schema";
import type { ScanTarget } from "../../shared/schemas/scan-target.schema";
import type { ScanProfileResolution } from "../../shared/schemas/scan-profile-catalog.schema";
import { hashResolvedProfile } from "../modules/scans/resolved-profile";
import type { ToolRunnerKind } from "../modules/scans/tools/tool-process-runner";

export function buildScanProfileDryRun(params: {
	profile: ScanProfile;
	scanTarget: ScanTarget;
	stepId?: string;
	timeoutSec?: number;
	runner?: ToolRunnerKind;
	finalReportEnabled: boolean;
	automatedDiagnosticEnabled: boolean;
	imageRef?: string;
	imageTar?: string;
	preflight?: ScanPreflightResult;
	expectedPreflightBindingHash?: string;
	expectedPlanHash?: string;
	expectedCatalogEntryHash?: string;
	profileResolution?: ScanProfileResolution;
	executionPlan?: ScanExecutionPlan;
}): Record<string, unknown> {
	const allSteps = params.profile.steps ?? [];
	const selectedSteps = params.stepId
		? allSteps.filter((step) => stepIdFor(step) === params.stepId)
		: allSteps;
	if (params.stepId && selectedSteps.length === 0) {
		return {
			ok: false,
			status: "failed",
			message: `Invalid profile step: ${params.stepId}`,
		};
	}
	if (
		params.expectedPreflightBindingHash &&
		params.preflight &&
		params.expectedPreflightBindingHash !== params.preflight.bindingHash
	) {
		return {
			ok: false,
			status: "failed",
			message: "preflight_changed: preflight binding changed after preview",
			preflight: params.preflight,
		};
	}
	if (
		params.expectedPlanHash &&
		(!params.executionPlan ||
			params.expectedPlanHash !== params.executionPlan.planHash)
	) {
		return {
			ok: false,
			status: "failed",
			message: params.executionPlan
				? "plan_changed: execution plan changed after preview"
				: "plan_preview_unavailable: an execution plan requires a project target",
			preflight: params.preflight ?? null,
			executionPlan: params.executionPlan ?? null,
		};
	}
	if (
		params.expectedCatalogEntryHash &&
		params.profileResolution &&
		params.expectedCatalogEntryHash !==
			params.profileResolution.catalogEntryHash
	) {
		return {
			ok: false,
			status: "failed",
			message:
				"catalog_entry_changed: profile catalog entry changed after preview",
			profileResolution: params.profileResolution,
		};
	}
	return {
		dryRun: true,
		profileId: params.profile.id,
		...(params.profileResolution
			? {
					profileResolution: params.profileResolution,
					canonicalProfileId: params.profileResolution.canonicalProfileId,
					executionProfileId: params.profileResolution.executionProfileId,
					resultPolicy: params.profileResolution.resultPolicy,
				}
			: {}),
		resolvedProfileHash: hashResolvedProfile(params.profile),
		coverageMeasurement: "not_measured" as const,
		capabilityRequirements: params.profile.capabilityRequirements ?? [],
		preflight: params.preflight ?? null,
		executionPlan: params.executionPlan ?? null,
		target: params.scanTarget,
		runner: params.runner ?? "host",
		finalReport: params.finalReportEnabled,
		automatedDiagnostic: params.automatedDiagnosticEnabled,
		stepId: params.stepId ?? null,
		toolOrder: params.profile.tools.map((tool) => tool.toolId),
		stepOrder: selectedSteps.map(stepIdFor),
		resolvedTools: params.profile.tools.map((tool) => ({
			toolId: tool.toolId,
			displayName: tool.displayName,
			required: tool.required,
			timeoutSec:
				tool.timeoutSec ??
				params.timeoutSec ??
				params.profile.defaultTimeoutSec,
			options: tool.options ?? {},
		})),
		resolvedSteps: selectedSteps.map((step) => ({
			kind: step.kind,
			id: stepIdFor(step),
			displayName: step.displayName,
			required: step.required,
			timeoutSec:
				step.timeoutSec ??
				params.timeoutSec ??
				params.profile.defaultTimeoutSec,
			failurePolicy: step.failurePolicy,
			target: "target" in step ? step.target : undefined,
			applicabilityInput:
				step.kind === "container_image_scan"
					? params.imageRef
						? "image-ref"
						: params.imageTar
							? "image-tar"
							: "missing"
					: undefined,
		})),
	};
}

function stepIdFor(step: NonNullable<ScanProfile["steps"]>[number]): string {
	return step.kind === "static_tool"
		? step.toolId
		: step.kind === "dast"
			? `dast:${step.profileId}`
			: `${step.kind}:${step.adapter}`;
}
