import type { ScanPreflightMode } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import type { AppDatabase } from "../../../db";
import type { DastAuthContextRepository } from "../../dast/auth-context-repository";
import type { RuntimeTargetProvider } from "../../dast/runtime-target-provider";
import type { RuntimeIsolationProviderFactory } from "../../runtime-isolation/runtime-isolation-provider-factory";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import { canonicalJson } from "./diff/diff-scan-plan";
import {
	type DiffSnapshot,
	materializeDiffSnapshot,
} from "./diff/diff-snapshot";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import { materializeScopedSourceSnapshot } from "./lifecycle/full-source-snapshot";
import {
	bindNonFileProfileInputs,
	materializeProfileInputSnapshot,
	type ProfileInputSnapshot,
} from "./lifecycle/profile-input-snapshot";
import type { ProfileScanResult } from "./profile-runner";
import { executeProfileSteps } from "./profile-step-orchestrator";
import { applyExecutionPlanToSteps } from "./scan-execution-plan-builder";
import { hashProfileInputs } from "./scan-preflight-binding";
import { prepareProfileScanAdmission } from "./profile-orchestrator-admission";
import { finalizeProfileScan } from "./profile-orchestrator-finalize";
import { prepareProfileScan } from "./profile-orchestrator-prepare";
import { cleanupExecutionWorkspaces } from "./profile-orchestrator-workspace-cleanup";

export { cleanupExecutionWorkspaces } from "./profile-orchestrator-workspace-cleanup";

export type ProfileOrchestratorParams = {
	db: AppDatabase;
	scanRunId?: string;
	projectId: string;
	profileId: string;
	stepId?: string;
	repoPath: string;
	continueOnToolFailure?: boolean;
	timeoutSec?: number;
	createdByUserId?: string | null;
	authContextRepository?: DastAuthContextRepository;
	authContextId?: string;
	identityRole?: string;
	execution?: ToolExecutionConfig;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	executionPolicyMetadata?: Record<string, unknown>;
	executionSurface?: "cli" | "web" | "security_oracle" | "nightworkers";
	target?: ScanTarget;
	expectedTargetDigest?: string;
	consentProjectCodeExecution?: boolean;
	preflightMode?: ScanPreflightMode;
	expectedPreflightBindingHash?: string;
	expectedPlanHash?: string;
	expectedCatalogEntryHash?: string;
	resultPolicy?: "advisory" | "gate";
	allowExperimental?: boolean;
	/** SHA-256 of an externally materialized immutable source archive. */
	sourceSnapshotDigest?: string;
	runtimeTargetProvider?: RuntimeTargetProvider;
	runtimeTargetProviderFactory?: RuntimeIsolationProviderFactory;
	executionPlanSchemaVersion?: 1 | 2 | 3;
	dependencyResolutionMode?: "offline" | "registry";
	mavenResolverImage?: string;
	mavenResolutionConfig?: unknown;
};

export async function runProfileScan(
	params: ProfileOrchestratorParams,
): Promise<ProfileScanResult> {
	const {
		scanRepo,
		artifactRepo,
		artifactStorage,
		execution,
		requestedTarget,
		catalogEntry,
		profile,
		resolution,
		executionProfileId,
		resolvedProfileHash,
		fullScanTarget,
		resolvedScope,
		technologyAnalysis,
		mavenProjectDetected,
		profileSteps,
		diffPlan,
		mavenResolutionApplicable,
		sharesRuntimeTarget,
		stepOrder,
		continueOnToolFailure,
		initialMetadata,
	} = await prepareProfileScan(params);

	const admission = await prepareProfileScanAdmission({
		params,
		scanRepo,
		initialMetadata,
		resolution,
		profileSteps,
		fullScanTarget,
		resolvedScope,
		profile,
		execution,
		requestedTarget,
		mavenProjectDetected,
		mavenResolutionApplicable,
		diffPlan,
		technologyAnalysis,
		executionProfileId,
	});
	if (admission.blockedResult) return admission.blockedResult;
	const { scanRun, scanPreflight, executionPlan } = admission;
	let { fullSourceSnapshot, runtimeTargetProvider, runtimeProviderDispose } =
		admission;

	let diffSnapshot: DiffSnapshot | null = null;
	let profileInputSnapshot: ProfileInputSnapshot | null = null;
	let diffManifestArtifactId: string | null = null;
	try {
		profileInputSnapshot = await materializeProfileInputSnapshot({
			repositoryPath: params.repoPath,
			imageRef: params.imageRef,
			imageTar: params.imageTar,
			attestationSubject: params.attestationSubject,
			attestationBundle: params.attestationBundle,
			trustPolicy: params.trustPolicy,
			slsaProvenance: params.slsaProvenance,
			slsaPolicy: params.slsaPolicy,
		});
		if (
			profileInputSnapshot &&
			hashProfileInputs(
				bindNonFileProfileInputs(profileInputSnapshot.bindings, {
					authContextId: params.authContextId,
					identityRole: params.identityRole,
					dependencyResolutionMode:
						params.dependencyResolutionMode ?? "offline",
					mavenResolutionConfigDigest:
						scanPreflight.checks.find(
							(check) => check.id === "static_tool:osv:maven-resolution-config",
						)?.observedDigest ?? undefined,
					mavenResolutionSourceDigest:
						scanPreflight.checks.find(
							(check) => check.id === "static_tool:osv:maven-resolution-source",
						)?.observedDigest ?? undefined,
					mavenResolverImageId: scanPreflight.checks
						.find((check) => check.id === "runtime:docker-image:maven-resolver")
						?.evidenceRefs.find((reference) =>
							reference.startsWith("docker-image-id:"),
						)
						?.slice("docker-image-id:".length),
				}),
			) !== scanPreflight.binding.profileInputsHash
		) {
			throw new Error("profile_input_changed_after_preflight");
		}
	} catch (error) {
		let failure = error;
		if (profileInputSnapshot) {
			try {
				await cleanupExecutionWorkspaces({
					scanRepo,
					scanRunId: scanRun.id,
					workspaces: [
						{
							kind: "profile_input_snapshot",
							cleanup: profileInputSnapshot.cleanup,
						},
					],
				});
			} catch (cleanupError) {
				failure = cleanupError;
			}
		}
		const message =
			failure instanceof Error ? failure.message : String(failure);
		await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
			summary: message,
			profileOutcome: "blocked",
			metadata: {
				...scanRun.metadata,
				...initialMetadata,
				terminationReason: message,
			},
		});
		throw failure;
	}
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
			const artifact = await new ScanArtifactSink(
				artifactStorage,
				artifactRepo,
				{ scanRunId: scanRun.id, kind: "scan", id: "diff-manifest" },
			).saveText({
				role: "diff_manifest",
				format: "json",
				content: `${canonicalJson(diffPlan.manifest)}\n`,
				metadata: {
					schemaVersion: 1,
					targetDigest: diffPlan.target.targetDigest,
				},
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
			let failure = error;
			try {
				await cleanupExecutionWorkspaces({
					scanRepo,
					scanRunId: scanRun.id,
					workspaces: [
						...(diffSnapshot
							? [{ kind: "diff_snapshot", cleanup: diffSnapshot.cleanup }]
							: []),
						...(profileInputSnapshot
							? [
									{
										kind: "profile_input_snapshot",
										cleanup: profileInputSnapshot.cleanup,
									},
								]
							: []),
					],
				});
			} catch (cleanupError) {
				failure = cleanupError;
			}
			const message =
				failure instanceof Error ? failure.message : String(failure);
			await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
				summary: message,
				profileOutcome: "failed",
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
			throw failure;
		}
	}
	if (fullScanTarget && !fullSourceSnapshot) {
		try {
			fullSourceSnapshot = await materializeScopedSourceSnapshot({
				repositoryPath: params.repoPath,
				sourceRevision: fullScanTarget.sourceRevision,
				scope: resolvedScope.scope,
			});
			if (
				fullScanTarget.scopeContentDigest &&
				fullSourceSnapshot.snapshotDigest !== fullScanTarget.scopeContentDigest
			) {
				throw new Error(
					"target_changed: scoped target changed before execution",
				);
			}
			await scanRepo.mergeScanRunMetadata(scanRun.id, {
				fullSourceSnapshot: {
					sourceRevision: fullSourceSnapshot.sourceRevision,
					snapshotDigest: fullSourceSnapshot.snapshotDigest,
					snapshotKind: "scoped_worktree",
				},
			});
		} catch (error) {
			let failure = error;
			try {
				await cleanupExecutionWorkspaces({
					scanRepo,
					scanRunId: scanRun.id,
					workspaces: [
						...(fullSourceSnapshot
							? [
									{
										kind: "source_snapshot",
										cleanup: fullSourceSnapshot.cleanup,
									},
								]
							: []),
						...(runtimeProviderDispose
							? [
									{
										kind: "runtime_projection",
										cleanup: runtimeProviderDispose,
									},
								]
							: []),
						...(profileInputSnapshot
							? [
									{
										kind: "profile_input_snapshot",
										cleanup: profileInputSnapshot.cleanup,
									},
								]
							: []),
					],
				});
			} catch (cleanupError) {
				failure = cleanupError;
			}
			await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
				summary:
					"Scan failed because the immutable source snapshot could not be created.",
				profileOutcome: "failed",
				metadata: {
					...scanRun.metadata,
					...initialMetadata,
					terminationReason: "source_snapshot_materialization_failed",
				},
			});
			throw failure;
		}
	}

	let executionResult: Awaited<ReturnType<typeof executeProfileSteps>>;
	try {
		executionResult = await (async () => {
			try {
				return await executeProfileSteps({
					db: params.db,
					projectId: params.projectId,
					repoPath: fullSourceSnapshot?.projectPath ?? params.repoPath,
					profileInputRepoPath:
						profileInputSnapshot?.rootPath ?? params.repoPath,
					timeoutSec: params.timeoutSec,
					createdByUserId: params.createdByUserId,
					authContextRepository: params.authContextRepository,
					authContextId: params.authContextId,
					identityRole: params.identityRole,
					dependencyResolutionMode:
						params.dependencyResolutionMode ?? "offline",
					mavenResolverImage: params.mavenResolverImage,
					mavenResolutionConfig: params.mavenResolutionConfig,
					mavenProjectDetected,
					imageRef: params.imageRef,
					imageTar: params.imageTar,
					attestationSubject: params.attestationSubject,
					attestationBundle: params.attestationBundle,
					trustPolicy: params.trustPolicy,
					slsaProvenance: params.slsaProvenance,
					slsaPolicy: params.slsaPolicy,
					scanRepo,
					scanRun,
					profile,
					profileSteps: applyExecutionPlanToSteps(profileSteps, executionPlan),
					continueOnToolFailure,
					diffPlan,
					diffSnapshot,
					sharesRuntimeTarget,
					resolvedScope,
					artifactStorage,
					execution,
					technologyAnalysis,
					consentProjectCodeExecution:
						params.consentProjectCodeExecution === true,
					runtimeTargetProvider,
					scanPreflight,
					executionPlan,
				});
			} finally {
				await cleanupExecutionWorkspaces({
					scanRepo,
					scanRunId: scanRun.id,
					workspaces: [
						...(fullSourceSnapshot
							? [
									{
										kind: "source_snapshot",
										cleanup: fullSourceSnapshot.cleanup,
									},
								]
							: []),
						...(runtimeProviderDispose
							? [
									{
										kind: "runtime_projection",
										cleanup: runtimeProviderDispose,
									},
								]
							: []),
						...(diffSnapshot
							? [{ kind: "diff_snapshot", cleanup: diffSnapshot.cleanup }]
							: []),
						...(profileInputSnapshot
							? [
									{
										kind: "profile_input_snapshot",
										cleanup: profileInputSnapshot.cleanup,
									},
								]
							: []),
					],
				});
			}
		})();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const currentScan = await scanRepo.findById(scanRun.id);
		await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
			summary: message,
			profileOutcome: "failed",
			metadata: {
				...(currentScan?.metadata ?? scanRun.metadata),
				...initialMetadata,
				terminationReason: message,
			},
		});
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "error",
			eventType: "scan.failed",
			message,
		});
		throw error;
	}
	const {
		toolResults,
		stepResults,
		profileFailingToolFailed,
		optionalToolFailed,
	} = executionResult;

	return await finalizeProfileScan({
		params,
		scanRepo,
		scanRun,
		technologyAnalysis,
		profile,
		executionPlan,
		scanPreflight,
		resolution,
		catalogEntry,
		resolvedProfileHash,
		resolvedScope,
		continueOnToolFailure,
		execution,
		stepOrder,
		diffPlan,
		diffManifestArtifactId,
		executionProfileId,
		toolResults,
		stepResults,
		profileFailingToolFailed,
		optionalToolFailed,
	});
}
