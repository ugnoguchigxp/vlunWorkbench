import type { AppDatabase } from "../../db";
import type { ScanTarget } from "../../../shared/schemas/scan-target.schema";
import { authorizeProjectPath } from "../../security/project-path-policy";
import { prepareDastTargetWorkspace } from "../dast/target-preparer";
import { ArtifactStorage } from "./artifact-storage";
import {
	buildDiffScanPlan,
	canonicalJson,
	type DiffScanPlan,
	shouldUseChangedWorkspaceForSemgrep,
} from "./diff-scan-plan";
import { materializeDiffSnapshot, type DiffSnapshot } from "./diff-snapshot";
import { resolveGitDiff } from "./git-diff-resolver";
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
import { ArtifactRepository, ScanRepository } from "./repositories";
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
	target?: ScanTarget;
	expectedTargetDigest?: string;
}): Promise<ProfileScanResult> {
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
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
	const requestedTarget: ScanTarget = params.target ?? { kind: "full" };
	const supportedTargets = profile.supportedTargets ?? ["full"];
	if (!supportedTargets.includes(requestedTarget.kind)) {
		throw new Error(
			`diff_target_not_supported: profile ${profile.id} does not support target ${requestedTarget.kind}`,
		);
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
	const diffPlan: DiffScanPlan | null =
		requestedTarget.kind === "full"
			? null
			: buildDiffScanPlan({
					resolved: await resolveGitDiff({
						projectPath: params.repoPath,
						target: requestedTarget,
						scope: profile.scope,
					}),
					tools: profileSteps.flatMap((step) =>
						step.kind === "static_tool" ? [step] : [],
					),
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
		...(diffPlan
			? {
					target: diffPlan.target,
					diffCoverage: diffPlan.manifest.coverage,
					diffToolApplicability: diffPlan.tools,
				}
			: {}),
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

	let diffSnapshot: DiffSnapshot | null = null;
	let diffManifestArtifactId: string | null = null;
	if (diffPlan) {
		try {
			const hasApplicableTool = diffPlan.tools.some(
				(tool) => tool.applicability === "applicable",
			);
			if (hasApplicableTool) {
				diffSnapshot = await materializeDiffSnapshot({
					plan: diffPlan,
					expectedTargetDigest: params.expectedTargetDigest,
				});
				const trivyApplicability = diffPlan.tools.find(
					(tool) => tool.toolId === "trivy",
				);
				if (trivyApplicability) {
					trivyApplicability.contextFileCount =
						diffSnapshot.trivyContextFileCount;
				}
			} else if (
				params.expectedTargetDigest &&
				params.expectedTargetDigest !== diffPlan.target.targetDigest
			) {
				throw new Error("target_changed: diff target changed after preview");
			}
			diffPlan.target.snapshotDigest =
				diffSnapshot?.snapshotDigest ?? diffPlan.target.targetDigest;
			diffPlan.manifest.target.snapshotDigest = diffPlan.target.snapshotDigest;
			const savedManifest = await artifactStorage.saveTextArtifact(
				scanRun.id,
				"manifests",
				`${canonicalJson(diffPlan.manifest)}\n`,
				"diff-manifest.json",
			);
			const artifact = await artifactRepo
				.createArtifact({
					scanRunId: scanRun.id,
					toolRunId: null,
					kind: "diff_manifest",
					format: "json",
					path: savedManifest.path,
					sha256: savedManifest.sha256,
					sizeBytes: savedManifest.sizeBytes,
					metadata: {
						schemaVersion: 1,
						targetDigest: diffPlan.target.targetDigest,
					},
				})
				.catch(async (error) => {
					await artifactStorage
						.removeArtifacts([savedManifest.path])
						.catch(() => undefined);
					throw error;
				});
			diffManifestArtifactId = artifact.id;
			await scanRepo.mergeScanRunMetadata(scanRun.id, {
				target: diffPlan.target,
				diffCoverage: diffPlan.manifest.coverage,
				diffToolApplicability: diffPlan.tools,
				diffManifestArtifactId,
			});
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "info",
				eventType: "diff.target_resolved",
				message: `Resolved ${diffPlan.target.kind} target with ${diffPlan.manifest.coverage.changed} changed paths.`,
				data: {
					targetDigest: diffPlan.target.targetDigest,
					coverage: diffPlan.manifest.coverage,
					artifactId: diffManifestArtifactId,
				},
			});
		} catch (error) {
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
			const message = error instanceof Error ? error.message : String(error);
			await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
				summary: message,
				metadata: {
					...scanRun.metadata,
					target: diffPlan.target,
					diffCoverage: diffPlan.manifest.coverage,
					terminationReason: "diff_target_resolution_failed",
				},
			});
			await scanRepo.createScanEvent({
				scanRunId: scanRun.id,
				level: "error",
				eventType: "diff.target_failed",
				message,
			});
			throw error;
		}
	}

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
			...(diffPlan
				? {
						target: diffPlan.target,
						diffCoverage: diffPlan.manifest.coverage,
						diffToolApplicability: diffPlan.tools,
						diffManifestArtifactId,
					}
				: {}),
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
