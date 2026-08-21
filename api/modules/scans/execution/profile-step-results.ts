import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import type { ScanProfileStepResult, ToolResult } from "./profile-runner";

export type PlannedStepResult = {
	toolResult: ToolResult | null;
	stepResult: ScanProfileStepResult;
};

export function notApplicablePlannedStepResult(params: {
	step: ScanProfileStep;
	stepId: string;
	reasonCode: string;
	executionPlanHash: string;
}): PlannedStepResult {
	const { step, stepId, reasonCode, executionPlanHash } = params;
	if (step.kind === "static_tool") {
		const toolResult: ToolResult = {
			toolId: step.toolId,
			toolRunId: null,
			required: false,
			status: "skipped",
			findingCount: 0,
			exitCode: null,
			error: null,
			applicability: "not_applicable",
			reasonCode,
			coverageEffect: "gap",
			artifactIds: [],
			metadata: { executionPlanHash },
		};
		return { toolResult, stepResult: { kind: "static_tool", ...toolResult } };
	}
	if (step.kind === "dast") {
		return {
			toolResult: null,
			stepResult: {
				kind: "dast",
				profileId: step.profileId,
				required: false,
				status: "skipped",
				outcome: null,
				coverageStatus: "gap",
				limitationCodes: [reasonCode],
				findingCount: 0,
				dastRunId: null,
				targetOrigin: null,
				error: null,
			},
		};
	}
	return {
		toolResult: null,
		stepResult: {
			kind: step.kind,
			stepId,
			adapter: step.adapter,
			required: false,
			status: "skipped",
			applicability: "not_applicable",
			reasonCode,
			coverageEffect: "gap",
			findingCount: 0,
			error: null,
			metadata: { executionPlanHash },
		},
	};
}

export function preflightBlockedStepResult(params: {
	step: ScanProfileStep;
	stepId: string;
	preflightReasonCodes: string[];
}): PlannedStepResult {
	const { step, stepId, preflightReasonCodes } = params;
	const error = `Blocked by scan preflight: ${preflightReasonCodes.join(", ")}`;
	if (step.kind === "static_tool") {
		const toolResult: ToolResult = {
			toolId: step.toolId,
			toolRunId: null,
			required: step.required,
			status: "skipped",
			findingCount: 0,
			exitCode: null,
			error,
			applicability: "applicable",
			reasonCode: "preflight_failed",
			coverageEffect: "gap",
			artifactIds: [],
			metadata: { preflightReasonCodes },
		};
		return { toolResult, stepResult: { kind: "static_tool", ...toolResult } };
	}
	if (step.kind === "dast") {
		return {
			toolResult: null,
			stepResult: {
				kind: "dast",
				profileId: step.profileId,
				required: step.required,
				status: "skipped",
				outcome: null,
				coverageStatus: "gap",
				limitationCodes: ["preflight_failed", ...preflightReasonCodes],
				findingCount: 0,
				dastRunId: null,
				targetOrigin: null,
				error,
			},
		};
	}
	return {
		toolResult: null,
		stepResult: {
			kind: step.kind,
			stepId,
			adapter: step.adapter,
			required: step.required,
			status: "skipped",
			applicability: "applicable",
			reasonCode: "preflight_failed",
			coverageEffect: "gap",
			findingCount: 0,
			error,
			metadata: { preflightReasonCodes },
		},
	};
}
