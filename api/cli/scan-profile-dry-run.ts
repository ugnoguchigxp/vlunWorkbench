import type { ScanPreflightResult } from "../../shared/schemas/scan-preflight.schema";
import type { ScanProfile } from "../../shared/schemas/scan-profile.schema";
import type { ScanTarget } from "../../shared/schemas/scan-target.schema";
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
	return {
		dryRun: true,
		profileId: params.profile.id,
		resolvedProfileHash: hashResolvedProfile(params.profile),
		coverageGaps: params.profile.coverageGaps ?? [],
		preflight: params.preflight ?? null,
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
