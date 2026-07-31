import { prepareDastTargetWorkspace } from "../dast/target-preparer";
import { builtInTechnologyPluginRegistry } from "../../plugins/builtin";
import { shouldUseChangedWorkspaceForSemgrep } from "./diff-scan-plan";
import {
	runDastStepIntoExistingScan,
	runRuntimeScannerIntoExistingScan,
	runSchemaScannerIntoExistingScan,
	runToolIntoExistingScan,
	type ScanProfileStepResult,
	type ToolResult,
} from "./profile-runner";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";
import { withMandatoryExcludes } from "./target-scope";

export async function executeProfileSteps(
	params: ExecuteProfileStepsParams,
): Promise<{
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
	profileFailingToolFailed: boolean;
	optionalToolFailed: boolean;
}> {
	const {
		scanRepo,
		scanRun,
		profile,
		profileSteps,
		continueOnToolFailure,
		diffPlan,
		diffSnapshot,
		sharesRuntimeTarget,
		resolvedScope,
		artifactStorage,
		execution,
	} = params;
	const toolResults: ToolResult[] = [];
	const stepResults: ScanProfileStepResult[] = [];
	let sharedRuntimeTarget: Awaited<
		ReturnType<typeof prepareDastTargetWorkspace>
	> | null = null;
	const ensureSharedRuntimeTarget = async () => {
		if (!sharedRuntimeTarget) {
			sharedRuntimeTarget = await prepareDastTargetWorkspace({
				repoPath: params.repoPath,
				consentProjectCodeExecution: params.consentProjectCodeExecution,
			});
		}
		return sharedRuntimeTarget;
	};
	let profileFailingToolFailed = false;
	let optionalToolFailed = Boolean(
		diffPlan &&
			(diffPlan.manifest.coverage.unsupported > 0 ||
				diffPlan.manifest.coverage.tooLarge > 0),
	);

	try {
		for (const step of profileSteps) {
			const resolvedTimeout =
				step.timeoutSec ?? params.timeoutSec ?? profile.defaultTimeoutSec;
			const failureFailsProfile =
				step.required || step.failurePolicy === "fail_profile";

			const stepId =
				step.kind === "static_tool"
					? step.toolId
					: step.kind === "dast"
						? `dast:${step.profileId}`
						: `${step.kind}:${step.adapter}`;

			let toolRunId: string | null = null;
			let findingCount = 0;
			let stepArtifactIds: string[] = [];
			let diffUnmappedFindingCount = 0;
			let exitCode: number | null = null;
			let status: "completed" | "failed" | "skipped" = "completed";
			let error: string | null = null;

			// Check if we should skip due to earlier profile-failing tool failure.
			if (profileFailingToolFailed && !continueOnToolFailure) {
				status = "skipped";
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

			try {
				if (
					step.kind === "static_tool" ||
					step.kind === "sbom_export" ||
					step.kind === "container_image_scan"
				) {
					const toolId = step.kind === "static_tool" ? step.toolId : "trivy";
					const semgrepUsesChangedWorkspace =
						toolId === "semgrep" &&
						Boolean(
							diffPlan &&
								shouldUseChangedWorkspaceForSemgrep(diffPlan.scanPaths),
						);
					const diffInputKind =
						(toolId === "semgrep" && !semgrepUsesChangedWorkspace) ||
						toolId === "osv"
							? "full_snapshot"
							: "changed_workspace";
					const toolRepoPath =
						diffPlan && step.kind === "static_tool"
							? diffInputKind === "full_snapshot"
								? diffSnapshot?.projectPath
								: toolId === "trivy"
									? diffSnapshot?.trivyWorkspacePath
									: diffSnapshot?.changedWorkspacePath
							: params.repoPath;
					if (!toolRepoPath) {
						throw new Error(
							"snapshot_materialization_failed: scanner input is unavailable",
						);
					}
					const toolRes = await runToolIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						toolId,
						options: {
							...(("options" in step ? step.options : undefined) ?? {}),
							...(toolId === "semgrep"
								? {
										semgrepRuleContributions: builtInTechnologyPluginRegistry
											.semgrepRules()
											.filter((contribution) =>
												params.technologyAnalysis.capabilityPlan.activePluginIds.includes(
													contribution.pluginId,
												),
											),
									}
								: {}),
							...(step.kind === "sbom_export" ? { mode: "fs-sbom" } : {}),
							...(step.kind === "container_image_scan"
								? {
										mode: "image",
										imageRef: params.imageRef,
										imageTar: params.imageTar,
									}
								: {}),
							scope: withMandatoryExcludes(profile.scope),
							scopeSummary: resolvedScope,
						},
						artifactStorage,
						timeoutSec: resolvedTimeout,
						repoPath: toolRepoPath,
						execution,
						diffContext:
							diffPlan && step.kind === "static_tool"
								? {
										target: diffPlan.target,
										entries: diffPlan.manifest.entries,
										targetPaths:
											toolId === "semgrep" && !semgrepUsesChangedWorkspace
												? diffPlan.scanPaths
												: undefined,
										inputKind: diffInputKind,
										contextFileCount:
											toolId === "trivy"
												? diffSnapshot?.trivyContextFileCount
												: 0,
									}
								: undefined,
					});

					toolRunId = toolRes.toolRunId;
					findingCount = toolRes.findingCount;
					exitCode = toolRes.exitCode;
					stepArtifactIds = toolRes.artifactIds;
					diffUnmappedFindingCount = toolRes.diffUnmappedFindingCount;
					if (diffUnmappedFindingCount > 0) {
						optionalToolFailed = true;
					}
					status = "completed";
				} else if (step.kind === "dast") {
					const target = sharesRuntimeTarget
						? await ensureSharedRuntimeTarget()
						: undefined;
					const dastResult = await runDastStepIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						step,
						repoPath: params.repoPath,
						timeoutSec: resolvedTimeout,
						createdByUserId: params.createdByUserId,
						preparedAutoTarget: target,
						consentProjectCodeExecution: params.consentProjectCodeExecution,
					});
					stepResults.push(dastResult);
					findingCount = dastResult.findingCount;
					status = dastResult.status;
					error = dastResult.error;
					if (dastResult.status === "failed") {
						if (failureFailsProfile) {
							profileFailingToolFailed = true;
						} else {
							optionalToolFailed = true;
						}
					} else if (dastResult.coverageStatus !== "covered") {
						optionalToolFailed = true;
					}
					continue;
				} else if (step.kind === "runtime_scanner") {
					const target = await ensureSharedRuntimeTarget();
					const runtimeOptions = step.options as
						| { maxRequests?: number; rateLimitPerSec?: number }
						| undefined;
					const runtimeResult = await runRuntimeScannerIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						adapter: step.adapter,
						targetOrigin: target.origin,
						artifactStorage,
						timeoutSec: resolvedTimeout,
						execution,
						allowedPaths: target.targetConfig.allowedPathsJson,
						excludedPaths: target.targetConfig.excludedPathsJson,
						maxRequests: runtimeOptions?.maxRequests,
						rateLimitPerSec: runtimeOptions?.rateLimitPerSec,
					});
					const runtimeFailed = Boolean(runtimeResult.error);
					stepResults.push({
						kind: step.kind,
						stepId,
						adapter: step.adapter,
						required: step.required,
						status: runtimeFailed ? "failed" : "completed",
						applicability: "applicable",
						reasonCode: runtimeResult.reasonCode ?? null,
						coverageEffect: runtimeFailed ? "gap" : "covered",
						findingCount: runtimeResult.findingCount,
						error: runtimeResult.error ?? null,
						artifactIds: runtimeResult.artifactIds,
						metadata: runtimeResult.metadata,
					});
					if (runtimeFailed) {
						if (failureFailsProfile) profileFailingToolFailed = true;
						else optionalToolFailed = true;
					}
					continue;
				} else if (step.kind === "api_schema_scan") {
					const target = await ensureSharedRuntimeTarget();
					const schemaOptions = step.options as
						| { maxRequests?: number; rateLimitPerSec?: number }
						| undefined;
					const schemaResult = await runSchemaScannerIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						repoPath: params.repoPath,
						targetOrigin: target.origin,
						artifactStorage,
						timeoutSec: resolvedTimeout,
						execution,
						allowedPaths: target.targetConfig.allowedPathsJson,
						excludedPaths: target.targetConfig.excludedPathsJson,
						maxRequests: schemaOptions?.maxRequests,
						rateLimitPerSec: schemaOptions?.rateLimitPerSec,
					});
					const notApplicable = !schemaResult.applicable;
					const schemaFailed = Boolean(schemaResult.error);
					stepResults.push({
						kind: step.kind,
						stepId,
						adapter: step.adapter,
						required: step.required,
						status: notApplicable
							? "skipped"
							: schemaFailed
								? "failed"
								: "completed",
						applicability: notApplicable ? "not_applicable" : "applicable",
						reasonCode: schemaResult.reasonCode ?? null,
						coverageEffect: notApplicable || schemaFailed ? "gap" : "covered",
						findingCount: schemaResult.findingCount,
						error: schemaResult.error ?? null,
						artifactIds: schemaResult.artifactIds,
						metadata: schemaResult.metadata,
					});
					if (schemaFailed && failureFailsProfile)
						profileFailingToolFailed = true;
					else if (schemaFailed || notApplicable) optionalToolFailed = true;
					continue;
				}
			} catch (err: unknown) {
				status = "failed";
				error = err instanceof Error ? err.message : String(err);

				if (failureFailsProfile) {
					profileFailingToolFailed = true;
				} else {
					optionalToolFailed = true;
				}
				if (
					step.kind === "runtime_scanner" ||
					step.kind === "api_schema_scan"
				) {
					stepResults.push({
						kind: step.kind,
						stepId,
						adapter: step.adapter,
						required: step.required,
						status: "failed",
						applicability: "applicable",
						reasonCode: error.includes("policy_rejected")
							? "policy_rejected"
							: "execution_failed",
						coverageEffect: "gap",
						findingCount: 0,
						error,
					});
					continue;
				}
				if (step.kind === "dast") {
					stepResults.push({
						kind: "dast",
						profileId: step.profileId,
						required: step.required,
						status: "failed",
						outcome: "error",
						findingCount: 0,
						dastRunId: null,
						targetOrigin: null,
						error,
					});
					continue;
				}
			}

			if (
				step.kind !== "static_tool" &&
				step.kind !== "sbom_export" &&
				step.kind !== "container_image_scan"
			)
				throw new Error(`Unsupported profile step: ${stepId}`);
			const toolResult = {
				toolId: step.kind === "static_tool" ? step.toolId : "trivy",
				toolRunId,
				required: step.required,
				status,
				findingCount,
				exitCode,
				error,
				applicability: "applicable" as const,
				reasonCode: status === "failed" ? "execution_failed" : null,
				coverageEffect:
					status === "failed"
						? ("gap" as const)
						: diffUnmappedFindingCount > 0
							? ("partial" as const)
							: (diffApplicability?.coverageEffect ?? ("covered" as const)),
				artifactIds: stepArtifactIds,
				metadata: diffPlan
					? {
							targetDigest: diffPlan.target.targetDigest,
							diffUnmappedFindingCount,
						}
					: undefined,
			};
			toolResults.push(toolResult);
			stepResults.push(
				step.kind === "static_tool"
					? { kind: "static_tool", ...toolResult }
					: {
							kind: step.kind,
							stepId,
							adapter: step.adapter,
							required: step.required,
							status,
							applicability:
								status === "completed" ? "applicable" : "not_applicable",
							reasonCode:
								status === "completed"
									? null
									: error?.includes("image_input_not_provided")
										? "image_input_not_provided"
										: "execution_failed",
							coverageEffect: status === "completed" ? "covered" : "gap",
							findingCount,
							error,
							artifactIds: stepArtifactIds,
						},
			);
		}
	} finally {
		const targetToStop = sharedRuntimeTarget as Awaited<
			ReturnType<typeof prepareDastTargetWorkspace>
		> | null;
		await targetToStop?.stop().catch(() => undefined);
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
