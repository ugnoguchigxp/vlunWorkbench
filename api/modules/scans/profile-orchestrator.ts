import type { AppDatabase } from "../../db";
import { authorizeProjectPath } from "../../security/project-path-policy";
import { prepareDastTargetWorkspace } from "../dast/target-preparer";
import { ArtifactStorage } from "./artifact-storage";
import {
	type FinalReportOptions,
	type FinalReportResult,
	generateFinalReport,
	type ProfileScanResult,
	resolveProfileSteps,
	runDastStepIntoExistingScan,
	runRuntimeScannerIntoExistingScan,
	runSchemaScannerIntoExistingScan,
	runToolIntoExistingScan,
	type ScanProfileStepResult,
	type ToolResult,
} from "./profile-runner";
import { getProfileById } from "./profiles";
import { ScanRepository } from "./repositories";
import { resolveScanScope, withMandatoryExcludes } from "./target-scope";
import {
	normalizeToolExecutionConfig,
	type ToolExecutionConfig,
} from "./tools/tool-process-runner";

export async function runProfileScan(params: {
	db: AppDatabase;
	scanRunId?: string;
	projectId: string;
	profileId: string;
	stepId?: string;
	repoPath: string;
	continueOnToolFailure?: boolean;
	timeoutSec?: number;
	createdByUserId?: string | null;
	execution?: ToolExecutionConfig;
	finalReport?: FinalReportOptions;
	imageRef?: string;
	imageTar?: string;
	executionPolicyMetadata?: Record<string, unknown>;
	executionSurface?: "cli" | "web";
	projectAllowedRoots?: readonly string[];
}): Promise<ProfileScanResult> {
	const scanRepo = new ScanRepository(params.db);
	const artifactStorage = new ArtifactStorage();
	const execution = normalizeToolExecutionConfig(params.execution);
	if (params.executionSurface === "web") {
		const authorized = await authorizeProjectPath({
			projectPath: params.repoPath,
			allowedRoots: params.projectAllowedRoots ?? [],
		});
		params.repoPath = authorized.canonicalPath;
	}

	const profile = getProfileById(params.profileId);
	if (!profile) {
		throw new Error(`Profile not found: ${params.profileId}`);
	}
	const finalReportOptions: Required<FinalReportOptions> = {
		enabled: params.finalReport?.enabled ?? false,
		title:
			params.finalReport?.title ??
			`${profile.name || params.profileId} 最終セキュリティレポート`,
		includeFalsePositives: params.finalReport?.includeFalsePositives ?? true,
		includeDeferred: params.finalReport?.includeDeferred ?? true,
		includeUndecided: params.finalReport?.includeUndecided ?? true,
	};
	const resolvedScope = await resolveScanScope({
		repoPath: params.repoPath,
		scope: profile.scope,
	});
	const profileSteps = resolveProfileSteps({
		steps: profile.steps,
		tools: profile.tools,
		stepId: params.stepId,
	});
	const sharesRuntimeTarget = profileSteps.some(
		(step) =>
			step.kind === "runtime_scanner" || step.kind === "api_schema_scan",
	);
	const stepOrder = profileSteps.map((step) =>
		step.kind === "static_tool"
			? step.toolId
			: step.kind === "dast"
				? `dast:${step.profileId}`
				: `${step.kind}:${"adapter" in step ? step.adapter : "unknown"}`,
	);

	const continueOnToolFailure = params.continueOnToolFailure ?? true;

	const initialMetadata = {
		profileId: params.profileId,
		profileVersion: 1,
		scope: resolvedScope,
		continueOnToolFailure,
		runner: execution.runner,
		toolOrder: profile.tools.map((t) => t.toolId),
		stepOrder,
		toolResults: [],
		stepResults: [],
		...(params.executionPolicyMetadata
			? { executionPolicy: params.executionPolicyMetadata }
			: {}),
	};

	// CLI/oracle callers create a running row; Web jobs atomically claim a queued row.
	const scanRun = params.scanRunId
		? await scanRepo.claimQueuedScanRun({
				id: params.scanRunId,
				projectId: params.projectId,
				profile: params.profileId,
				metadata: initialMetadata,
			})
		: await scanRepo.createScanRun({
				projectId: params.projectId,
				profile: params.profileId,
				status: "running",
				createdByUserId: params.createdByUserId,
				metadata: initialMetadata,
			});
	if (!scanRun) {
		throw new Error(`Queued scan could not be claimed: ${params.scanRunId}`);
	}

	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level: "info",
		eventType: "scan.started",
		message: `Scan profile ${params.profileId} started.`,
	});

	const toolResults: ToolResult[] = [];
	const stepResults: ScanProfileStepResult[] = [];
	let sharedRuntimeTarget: Awaited<
		ReturnType<typeof prepareDastTargetWorkspace>
	> | null = null;
	const ensureSharedRuntimeTarget = async () => {
		if (!sharedRuntimeTarget) {
			sharedRuntimeTarget = await prepareDastTargetWorkspace({
				repoPath: params.repoPath,
			});
		}
		return sharedRuntimeTarget;
	};
	let profileFailingToolFailed = false;
	let optionalToolFailed = false;

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

			try {
				if (
					step.kind === "static_tool" ||
					step.kind === "sbom_export" ||
					step.kind === "container_image_scan"
				) {
					const toolId = step.kind === "static_tool" ? step.toolId : "trivy";
					const toolRes = await runToolIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						toolId,
						options: {
							...(("options" in step ? step.options : undefined) ?? {}),
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
						repoPath: params.repoPath,
						execution,
					});

					toolRunId = toolRes.toolRunId;
					findingCount = toolRes.findingCount;
					exitCode = toolRes.exitCode;
					stepArtifactIds = toolRes.artifactIds;
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
					}
					continue;
				} else if (step.kind === "runtime_scanner") {
					const target = await ensureSharedRuntimeTarget();
					const zapOptions =
						step.adapter === "zap-baseline"
							? (step.options as
									| { maxRequests?: number; rateLimitPerSec?: number }
									| undefined)
							: undefined;
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
						maxRequests: zapOptions?.maxRequests,
						rateLimitPerSec: zapOptions?.rateLimitPerSec,
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
					const schemaResult = await runSchemaScannerIntoExistingScan({
						db: params.db,
						projectId: params.projectId,
						scanRunId: scanRun.id,
						repoPath: params.repoPath,
						targetOrigin: target.origin,
						artifactStorage,
						timeoutSec: resolvedTimeout,
						execution,
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
	}

	// Determine profile outcome
	let profileOutcome: "completed" | "completed_with_warnings" | "failed" =
		"completed";
	let finalScanStatus: "completed" | "failed" = "completed";

	if (profileFailingToolFailed) {
		// A fail_profile tool failed, so the overall outcome is failed.
		profileOutcome = "failed";
		finalScanStatus = "failed";
	} else if (optionalToolFailed) {
		// required tools succeeded, but at least one optional tool failed
		profileOutcome = "completed_with_warnings";
		finalScanStatus = "completed";
	} else {
		// all succeeded
		profileOutcome = "completed";
		finalScanStatus = "completed";
	}

	// Update Scan Run status
	const totalFindings = stepResults.reduce((acc, r) => acc + r.findingCount, 0);
	const summaryMsg =
		profileOutcome === "failed"
			? `Scan profile ${params.profileId} failed due to profile-failing tool failure.`
			: `Scan profile ${params.profileId} completed with outcome: ${profileOutcome}. Found ${totalFindings} findings total.`;

	await scanRepo.updateScanRunStatus(scanRun.id, finalScanStatus, {
		summary: summaryMsg,
		metadata: {
			...scanRun.metadata,
			profileId: params.profileId,
			profileVersion: 1,
			scope: resolvedScope,
			profileOutcome,
			continueOnToolFailure,
			runner: execution.runner,
			toolOrder: profile.tools.map((t) => t.toolId),
			stepOrder,
			toolResults,
			stepResults,
		},
	});

	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level: profileOutcome === "failed" ? "error" : "info",
		eventType: profileOutcome === "failed" ? "scan.failed" : "scan.completed",
		message: summaryMsg,
	});

	let finalReport: FinalReportResult | undefined;
	if (finalReportOptions.enabled) {
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "report.started",
			message: "Final scan report generation started.",
		});
		finalReport = await generateFinalReport({
			db: params.db,
			scanRunId: scanRun.id,
			artifactStorage,
			options: finalReportOptions,
		});
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: finalReport.ok ? "info" : "error",
			eventType: finalReport.ok ? "report.completed" : "report.failed",
			message: finalReport.ok
				? `Final scan report generated: ${finalReport.artifactPath}`
				: `Final scan report generation failed: ${finalReport.error}`,
			data: { ...finalReport },
		});
	}

	const ok = profileOutcome !== "failed" && (finalReport?.ok ?? true);
	const message =
		finalReport && !finalReport.ok
			? `${summaryMsg} Final report generation failed: ${finalReport.error}`
			: summaryMsg;

	return {
		ok,
		scanRunId: scanRun.id,
		profileId: params.profileId,
		status: finalScanStatus,
		profileOutcome,
		runner: execution.runner,
		message,
		toolResults,
		stepResults,
		finalReport,
	};
}
