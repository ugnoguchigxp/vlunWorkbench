import type { ScanTarget } from "../../../shared/schemas/scan-target.schema";
import type { AppDatabase } from "../../db";
import { authorizeProjectPath } from "../../security/project-path-policy";
import { ArtifactStorage } from "./artifact-storage";
import {
	buildDiffScanPlan,
	canonicalJson,
	type DiffScanPlan,
} from "./diff-scan-plan";
import { type DiffSnapshot, materializeDiffSnapshot } from "./diff-snapshot";
import { resolveFullScanTarget } from "./full-scan-target";
import { resolveGitDiff } from "./git-diff-resolver";
import {
	type FinalReportOptions,
	type FinalReportResult,
	generateFinalReport,
	type ProfileScanResult,
	resolveProfileSteps,
} from "./profile-runner";
import { executeProfileSteps } from "./profile-step-orchestrator";
import { aggregateRuntimeAssessmentCoverage } from "./runtime-assessment-coverage";
import { getProfileById } from "./profiles";
import { ArtifactRepository, ScanRepository } from "./repositories";
import { resolveScanScope } from "./target-scope";
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
	if (requestedTarget.kind === "full" && params.expectedTargetDigest) {
		const currentTarget = await resolveFullScanTarget(
			params.repoPath,
			profile.scope,
		);
		if (currentTarget.digest !== params.expectedTargetDigest) {
			throw new Error("target_changed: full target changed after preview");
		}
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

	const {
		toolResults,
		stepResults,
		profileFailingToolFailed,
		optionalToolFailed,
	} = await executeProfileSteps({
		db: params.db,
		projectId: params.projectId,
		repoPath: params.repoPath,
		timeoutSec: params.timeoutSec,
		createdByUserId: params.createdByUserId,
		imageRef: params.imageRef,
		imageTar: params.imageTar,
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
	});

	// Determine profile outcome
	const runtimeAssessmentCoverage =
		aggregateRuntimeAssessmentCoverage(stepResults);
	const runtimeCoverageLimited =
		runtimeAssessmentCoverage.steps.length > 0 &&
		runtimeAssessmentCoverage.coverageStatus !== "covered";
	let profileOutcome: "completed" | "completed_with_warnings" | "failed" =
		"completed";
	let finalScanStatus: "completed" | "failed" = "completed";

	if (profileFailingToolFailed) {
		// A fail_profile tool failed, so the overall outcome is failed.
		profileOutcome = "failed";
		finalScanStatus = "failed";
	} else if (optionalToolFailed || runtimeCoverageLimited) {
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
			runtimeAssessmentCoverage,
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
