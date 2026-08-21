import { executeProfileStep } from "./execute-profile-step";
import {
	emitScanStepFinished,
	emitScanStepStarted,
} from "./scan-step-lifecycle-events";
import type { ScanProfileStepResult, ToolResult } from "./profile-runner";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";
import {
	notApplicablePlannedStepResult,
	preflightBlockedStepResult,
} from "./profile-step-results";
import { scanProfileStepId } from "./scan-execution-plan-builder";
import {
	prepareSharedRuntimeTarget,
	type SharedRuntimeTarget,
} from "./shared-runtime-target";
import { ScanResourceLeaseRepository } from "./lifecycle/scan-resource-lease-repository";

function lifecycleOutcome(params: {
	result: ScanProfileStepResult | undefined;
	plannedNotApplicable: boolean;
	preflightBlocked: boolean;
	skippedDueToPriorFailure: boolean;
	fallbackReasonCode: string | null;
}): {
	outcome: "completed" | "failed" | "skipped" | "not_applicable" | "blocked";
	findingCount: number;
	reasonCode: string | null;
} {
	if (params.plannedNotApplicable) {
		return {
			outcome: "not_applicable",
			findingCount: 0,
			reasonCode: params.fallbackReasonCode,
		};
	}
	if (params.preflightBlocked) {
		return {
			outcome: "blocked",
			findingCount: 0,
			reasonCode: params.fallbackReasonCode ?? "preflight_failed",
		};
	}
	if (params.skippedDueToPriorFailure) {
		return {
			outcome: "skipped",
			findingCount: 0,
			reasonCode: "execution_failed",
		};
	}
	if (!params.result) {
		return {
			outcome: "failed",
			findingCount: 0,
			reasonCode: params.fallbackReasonCode ?? "step_execution_aborted",
		};
	}
	const result = params.result;
	const reasonCode =
		"reasonCode" in result
			? (result.reasonCode ?? null)
			: "limitationCodes" in result
				? (result.limitationCodes?.[0] ?? null)
				: null;
	if (result.status === "completed") {
		return {
			outcome: "completed",
			findingCount: result.findingCount,
			reasonCode,
		};
	}
	if (result.status === "failed") {
		return {
			outcome: "failed",
			findingCount: result.findingCount,
			reasonCode: reasonCode ?? "execution_failed",
		};
	}
	if ("applicability" in result && result.applicability === "not_applicable") {
		return {
			outcome: "not_applicable",
			findingCount: result.findingCount,
			reasonCode,
		};
	}
	return {
		outcome: "skipped",
		findingCount: result.findingCount,
		reasonCode,
	};
}

export async function executeProfileSteps(
	params: ExecuteProfileStepsParams,
): Promise<{
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
	profileFailingToolFailed: boolean;
	optionalToolFailed: boolean;
}> {
	// ScanExecution: plan (caller) → executeProfileStep(adapter|dast|runtime) → persist lifecycle.
	const {
		scanRepo,
		scanRun,
		profile,
		profileSteps,
		continueOnToolFailure,
		diffPlan,
		diffSnapshot,
		sharesRuntimeTarget,
	} = params;
	const toolResults: ToolResult[] = [];
	const stepResults: ScanProfileStepResult[] = [];
	const executionSteps = new Map(
		params.executionPlan.steps.map((planned) => [planned.stepId, planned]),
	);
	const sharedRuntimeTarget: { current: SharedRuntimeTarget | null } = {
		current: null,
	};
	const resourceLeases = new ScanResourceLeaseRepository(params.db);
	let runtimeTargetLeaseId: string | null = null;
	const ensureSharedRuntimeTarget = async () => {
		if (!sharedRuntimeTarget.current) {
			sharedRuntimeTarget.current = await prepareSharedRuntimeTarget({
				repoPath: params.repoPath,
				consentProjectCodeExecution: params.consentProjectCodeExecution,
				runtimeTargetProvider: params.runtimeTargetProvider,
			});
			const lease = await resourceLeases.acquire({
				scanRunId: scanRun.id,
				stepId: "runtime-target",
				resourceType: "runtime_target",
				provider: params.runtimeTargetProvider ? "injected" : "local",
				externalId: `${scanRun.id}:${sharedRuntimeTarget.current.origin}`,
				receipt: { origin: sharedRuntimeTarget.current.origin },
				leaseExpiresAt: new Date(
					Date.now() + Math.max(profile.defaultTimeoutSec, 60) * 1_000,
				),
			});
			runtimeTargetLeaseId = lease?.id ?? null;
		}
		return sharedRuntimeTarget.current;
	};
	let profileFailingToolFailed = false;
	let optionalToolFailed = Boolean(
		diffPlan &&
			(diffPlan.manifest.coverage.unsupported > 0 ||
				diffPlan.manifest.coverage.tooLarge > 0),
	);

	try {
		for (const [stepIndex, step] of profileSteps.entries()) {
			const resolvedTimeout =
				step.timeoutSec ?? params.timeoutSec ?? profile.defaultTimeoutSec;
			const failureFailsProfile =
				step.required || step.failurePolicy === "fail_profile";

			const stepId = scanProfileStepId(step);
			const planned = executionSteps.get(stepId);
			if (!planned) {
				throw new Error(`execution_plan_step_missing:${stepId}`);
			}
			const lifecycleContext = {
				scanRunId: scanRun.id,
				step,
				planned,
				position: stepIndex + 1,
				totalSteps: profileSteps.length,
				planHash: params.executionPlan.planHash,
			};
			const resultStartIndex = stepResults.length;
			let startedAtMs: number | null = null;
			let plannedNotApplicable = false;
			let preflightBlocked = false;
			let skippedDueToPriorFailure = false;
			let lifecycleReasonCode: string | null = null;

			try {
				// Skip / not-applicable stay in the orchestrator so lifecycle
				// events can be emitted without entering executeProfileStep.
				if (planned.applicability === "not_applicable") {
					plannedNotApplicable = true;
					const reasonCode = planned.reasonCodes[0] ?? "not_applicable";
					lifecycleReasonCode = reasonCode;
					const result = notApplicablePlannedStepResult({
						step,
						stepId,
						reasonCode,
						executionPlanHash: params.executionPlan.planHash,
					});
					if (result.toolResult) toolResults.push(result.toolResult);
					stepResults.push(result.stepResult);
					await scanRepo.createScanEvent({
						scanRunId: scanRun.id,
						level: "info",
						eventType: "tool.not_applicable",
						message: `${stepId} is not applicable according to the execution plan.`,
						data: {
							reasonCode,
							executionPlanHash: params.executionPlan.planHash,
						},
					});
					continue;
				}
				const preflightReasonCodes =
					params.scanPreflight.mode === "enforced" &&
					planned.readiness === "blocked"
						? planned.reasonCodes
						: [];
				if (preflightReasonCodes.length > 0) {
					preflightBlocked = true;
					lifecycleReasonCode = "preflight_failed";
					if (failureFailsProfile) profileFailingToolFailed = true;
					else optionalToolFailed = true;
					const result = preflightBlockedStepResult({
						step,
						stepId,
						preflightReasonCodes,
					});
					if (result.toolResult) toolResults.push(result.toolResult);
					stepResults.push(result.stepResult);
					continue;
				}

				// Check if we should skip due to earlier profile-failing tool failure.
				if (profileFailingToolFailed && !continueOnToolFailure) {
					skippedDueToPriorFailure = true;
					const status = "skipped" as const;
					if (step.kind === "static_tool") {
						const toolResult = {
							toolId: step.toolId,
							toolRunId: null,
							required: step.required,
							status,
							findingCount: 0,
							exitCode: null,
							error: "Skipped due to previous profile-failing tool failure",
							applicability: "applicable" as const,
							reasonCode: "execution_failed",
							coverageEffect: "gap" as const,
							artifactIds: [],
						};
						toolResults.push(toolResult);
						stepResults.push({ kind: "static_tool", ...toolResult });
					} else if (step.kind === "dast") {
						stepResults.push({
							kind: "dast",
							profileId: step.profileId,
							required: step.required,
							status,
							outcome: null,
							findingCount: 0,
							dastRunId: null,
							targetOrigin: null,
							error: "Skipped due to previous profile-failing step failure",
						});
					} else {
						stepResults.push({
							kind: step.kind,
							stepId,
							adapter: "adapter" in step ? step.adapter : "unknown",
							required: step.required,
							status,
							applicability: "not_applicable",
							reasonCode: "execution_failed",
							coverageEffect: "gap",
							findingCount: 0,
							error: "Skipped due to previous profile-failing step failure",
						});
					}
					continue;
				}

				const diffApplicability =
					step.kind === "static_tool" && diffPlan
						? diffPlan.tools.find((tool) => tool.toolId === step.toolId)
						: null;
				if (
					step.kind === "static_tool" &&
					diffPlan &&
					diffApplicability?.applicability === "not_applicable"
				) {
					const toolResult: ToolResult = {
						toolId: step.toolId,
						toolRunId: null,
						required: step.required,
						status: "skipped",
						findingCount: 0,
						exitCode: null,
						error: null,
						applicability: "not_applicable",
						reasonCode: diffApplicability.reasonCode,
						coverageEffect: diffApplicability.coverageEffect,
						artifactIds: [],
						metadata: {
							targetDigest: diffPlan.target.targetDigest,
						},
					};
					toolResults.push(toolResult);
					stepResults.push({ kind: "static_tool", ...toolResult });
					await scanRepo.createScanEvent({
						scanRunId: scanRun.id,
						level: "info",
						eventType: "tool.not_applicable",
						message: `${step.toolId} is not applicable to this diff target.`,
						data: {
							toolId: step.toolId,
							reasonCode: diffApplicability.reasonCode,
							targetDigest: diffPlan.target.targetDigest,
						},
					});
					continue;
				}

				startedAtMs = Date.now();
				await emitScanStepStarted(scanRepo, lifecycleContext);
				const executed = await executeProfileStep({
					step,
					stepId,
					resolvedTimeout,
					failureFailsProfile,
					diffPlan,
					diffSnapshot,
					sharesRuntimeTarget,
					ensureSharedRuntimeTarget,
					scope: params,
				});
				toolResults.push(...executed.toolResults);
				stepResults.push(...executed.stepResults);
				if (executed.profileFailingToolFailed) {
					profileFailingToolFailed = true;
				}
				if (executed.optionalToolFailed) {
					optionalToolFailed = true;
				}
			} finally {
				const details = lifecycleOutcome({
					result: stepResults[resultStartIndex],
					plannedNotApplicable,
					preflightBlocked,
					skippedDueToPriorFailure,
					fallbackReasonCode: lifecycleReasonCode,
				});
				await emitScanStepFinished(scanRepo, lifecycleContext, {
					...details,
					durationMs:
						startedAtMs === null ? null : Math.max(0, Date.now() - startedAtMs),
				});
			}
		}
	} finally {
		if (sharedRuntimeTarget.current) {
			try {
				await sharedRuntimeTarget.current.stop();
				if (runtimeTargetLeaseId) {
					await resourceLeases.release(runtimeTargetLeaseId, {
						stopped: true,
					});
				}
			} catch (cleanupError) {
				if (runtimeTargetLeaseId) {
					await resourceLeases.quarantine(runtimeTargetLeaseId, {
						reasonCode: "cleanup_failed",
					});
				}
				await scanRepo.createScanEvent({
					scanRunId: scanRun.id,
					level: "warn",
					eventType: "runtime_target.cleanup_failed",
					message: "Runtime target cleanup failed; resource was quarantined.",
					data: {
						errorType:
							cleanupError instanceof Error
								? cleanupError.name
								: "UnknownCleanupError",
					},
				});
			}
		}
		await diffSnapshot?.cleanup().catch(async (cleanupError) => {
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "warn",
				eventType: "diff.cleanup_failed",
				message: "Temporary diff snapshot cleanup failed.",
				data: {
					errorType:
						cleanupError instanceof Error
							? cleanupError.name
							: "UnknownCleanupError",
				},
			});
		});
	}
	return {
		toolResults,
		stepResults,
		profileFailingToolFailed,
		optionalToolFailed,
	};
}
