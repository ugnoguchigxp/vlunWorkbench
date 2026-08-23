import type { ScanPreflightMode } from "../../../../shared/schemas/scan-preflight.schema";
import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import type { AppDatabase } from "../../../db";
import { resolveProjectPath } from "../../../security/project-path-policy";
import type { RuntimeTargetProvider } from "../../dast/runtime-target-provider";
import {
	analyzeProjectCapabilities,
	buildPluginExecutionSummary,
} from "../../project-capabilities/plugin-detector";
import {
	buildRuntimeIsolationPreflight,
	runtimeIsolationExecutionPlanBinding,
} from "../../runtime-isolation/runtime-isolation-preflight";
import type { RuntimeIsolationProviderFactory } from "../../runtime-isolation/runtime-isolation-provider-factory";
import { buildCoverageLedger } from "../coverage/coverage-ledger";
import { aggregateRuntimeAssessmentCoverage } from "../coverage/runtime-assessment-coverage";
import { resolveSourceSastApplicability } from "../coverage/source-sast-applicability";
import { resolveSourceSastCoverage } from "../coverage/source-sast-coverage";
import { FindingRepository } from "../finding-repository";
import { getCatalogEntry, hashCatalogEntry } from "../profile-catalog";
import {
	normalizeProfileResolutionInput,
	resolveProfileSelection,
} from "../profile-resolution";
import { ArtifactRepository, ScanRepository } from "../repositories";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { resolveScanScope } from "../target-scope";
import {
	normalizeToolExecutionConfig,
	type ToolExecutionConfig,
} from "../tools/tool-process-runner";
import {
	buildDiffScanPlan,
	canonicalJson,
	type DiffScanPlan,
} from "./diff/diff-scan-plan";
import {
	type DiffSnapshot,
	materializeDiffSnapshot,
} from "./diff/diff-snapshot";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "./diff/git-diff-resolver";
import { resolveFullScanTarget } from "./full-scan-target";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
import { ArtifactStorage } from "./lifecycle/artifact-storage";
import {
	type FullSourceSnapshot,
	materializeScopedSourceSnapshot,
} from "./lifecycle/full-source-snapshot";
import {
	materializeProfileInputSnapshot,
	type ProfileInputSnapshot,
} from "./lifecycle/profile-input-snapshot";
import { normalizeProfileStepResult } from "./normalized-step-result";
import {
	assessProfessionalRunGroup,
	buildProfessionalRunGroupPhase56Handoff,
	buildProfessionalRunGroupPlan,
	qualifyProfessionalRunGroup,
} from "./professional-run-group";
import { type ProfileScanResult, resolveProfileSteps } from "./profile-runner";
import { executeProfileSteps } from "./profile-step-orchestrator";
import { hashResolvedProfile } from "./resolved-profile";
import {
	applyExecutionPlanToSteps,
	applyStrictProfileRequirements,
	buildScanExecutionPlan,
	executionPlanBlocks,
} from "./scan-execution-plan-builder";
import { preflightBlocksExecution, runScanPreflight } from "./scan-preflight";
import { hashProfileInputs } from "./scan-preflight-binding";
import { evaluateScanGate } from "./scan-result-policy";

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
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
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
}): Promise<ProfileScanResult> {
	if (
		params.sourceSnapshotDigest !== undefined &&
		!/^[a-f0-9]{64}$/.test(params.sourceSnapshotDigest)
	) {
		throw new Error("source_snapshot_digest_invalid");
	}
	const scanRepo = new ScanRepository(params.db);
	const artifactRepo = new ArtifactRepository(params.db);
	const artifactStorage = new ArtifactStorage();
	const execution = normalizeToolExecutionConfig(params.execution);
	if (params.executionSurface === "web") {
		const authorized = await resolveProjectPath(params.repoPath);
		params.repoPath = authorized.canonicalPath;
	}

	const requestedTarget: ScanTarget = params.target ?? { kind: "full" };
	const {
		catalogEntry,
		executionProfile: profile,
		resolution,
	} = resolveProfileSelection({
		requestedProfileId: params.profileId,
		surface: params.executionSurface ?? "cli",
		target: requestedTarget,
		providedInputKinds: normalizeProfileResolutionInput({
			repoPath: params.repoPath,
			imageRef: params.imageRef,
			imageTar: params.imageTar,
			attestationSubject: params.attestationSubject,
			attestationBundle: params.attestationBundle,
			trustPolicy: params.trustPolicy,
			autoStartPlan: Boolean(
				params.runtimeTargetProvider || params.runtimeTargetProviderFactory,
			),
			executionConsent: params.consentProjectCodeExecution,
		}),
		requestedResultPolicy: params.resultPolicy,
		allowExperimental: params.allowExperimental,
	});
	const executionProfileId = resolution.executionProfileId;
	if (!executionProfileId) {
		throw new Error("profile_resolution_execution_profile_missing");
	}
	if (
		params.expectedCatalogEntryHash &&
		params.expectedCatalogEntryHash !== resolution.catalogEntryHash
	) {
		throw new Error(
			"catalog_entry_changed: profile catalog entry changed after preview",
		);
	}
	const resolvedProfileHash = hashResolvedProfile(profile);
	const initialSourceSastCoverage = resolveSourceSastCoverage(profile);
	let fullScanTarget: Awaited<ReturnType<typeof resolveFullScanTarget>> | null =
		null;
	if (requestedTarget.kind === "full") {
		try {
			fullScanTarget = await resolveFullScanTarget(
				params.repoPath,
				profile.scope,
			);
		} catch (error) {
			// Existing non-Git projects remain scannable; immutable snapshots apply
			// when a fixed source revision is available.
			if (
				params.expectedTargetDigest ||
				!(error instanceof GitDiffResolutionError) ||
				error.code !== "not_a_git_repository"
			) {
				throw error;
			}
		}
	}
	if (
		fullScanTarget &&
		params.expectedTargetDigest &&
		fullScanTarget.digest !== params.expectedTargetDigest
	) {
		throw new Error("target_changed: full target changed after preview");
	}
	const resolvedScope = await resolveScanScope({
		repoPath: params.repoPath,
		scope: profile.scope,
	});
	const technologyAnalysis = await analyzeProjectCapabilities(params.repoPath);
	const selectedProfileSteps = resolveProfileSteps({
		steps: profile.steps,
		tools: profile.tools,
		stepId: params.stepId,
	});
	const profileSteps = applyStrictProfileRequirements(
		profile,
		selectedProfileSteps,
	);
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
					detectedPluginIds: technologyAnalysis.detections
						.filter((detection) => detection.detected)
						.map((detection) => detection.pluginId),
					projectInventoryPaths: technologyAnalysis.context.inventory.map(
						(entry) => entry.path,
					),
				});
	const sharesRuntimeTarget =
		profileSteps.some(
			(step) =>
				step.kind === "runtime_scanner" || step.kind === "api_schema_scan",
		) ||
		(Boolean(
			params.runtimeTargetProvider || params.runtimeTargetProviderFactory,
		) &&
			profileSteps.some((step) => step.kind === "dast"));
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
		canonicalProfileId: resolution.canonicalProfileId,
		executionProfileId: resolution.executionProfileId,
		profileResolution: resolution,
		catalogEntry,
		profileVersion: 1,
		resolvedProfile: profile,
		resolvedProfileHash,
		profileLimitationCodes: profile.coverageGaps ?? [],
		...(initialSourceSastCoverage
			? { sourceSastCoverage: initialSourceSastCoverage }
			: {}),
		scope: resolvedScope,
		continueOnToolFailure,
		runner: execution.runner,
		toolOrder: profile.tools.map((t) => t.toolId),
		stepOrder,
		toolResults: [],
		stepResults: [],
		technologyPlugins: {
			schemaVersion: 1,
			registryDigest: technologyAnalysis.capabilityPlan.registryDigest,
			detections: technologyAnalysis.detections,
			capabilityPlan: technologyAnalysis.capabilityPlan,
		},
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
		...(params.sourceSnapshotDigest
			? { sourceSnapshotDigest: params.sourceSnapshotDigest }
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
	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level: "info",
		eventType: "profile.resolved",
		message: `Resolved ${params.profileId} to ${resolution.executionProfileId}.`,
		data: resolution,
	});
	if (resolution.migrationKind !== "canonical") {
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "info",
			eventType: "profile.legacy_resolved",
			message: `Legacy profile ${params.profileId} resolved to ${resolution.executionProfileId}.`,
			data: resolution,
		});
	}

	let fullSourceSnapshot: FullSourceSnapshot | null = null;
	let runtimeTargetProvider = params.runtimeTargetProvider;
	let runtimeProviderDispose: (() => Promise<void>) | undefined;
	const needsIsolatedRuntime = profileSteps.some(
		(step) =>
			step.kind === "runtime_scanner" ||
			step.kind === "api_schema_scan" ||
			step.kind === "dast",
	);
	if (
		needsIsolatedRuntime &&
		!runtimeTargetProvider &&
		params.runtimeTargetProviderFactory &&
		fullScanTarget
	) {
		fullSourceSnapshot = await materializeScopedSourceSnapshot({
			repositoryPath: params.repoPath,
			sourceRevision: fullScanTarget.sourceRevision,
			scope: resolvedScope.scope,
		});
		if (
			fullScanTarget.scopeContentDigest &&
			fullSourceSnapshot.snapshotDigest !== fullScanTarget.scopeContentDigest
		) {
			await fullSourceSnapshot.cleanup();
			fullSourceSnapshot = null;
			throw new Error("target_changed: scoped target changed before execution");
		}
		try {
			runtimeTargetProvider = await params.runtimeTargetProviderFactory({
				scanRunId: scanRun.id,
				profileId: profile.id,
				sourceSnapshot: fullSourceSnapshot,
			});
			runtimeProviderDispose = runtimeTargetProvider.dispose;
			await scanRepo.mergeScanRunMetadata(scanRun.id, {
				fullSourceSnapshot: {
					sourceRevision: fullSourceSnapshot.sourceRevision,
					snapshotDigest: fullSourceSnapshot.snapshotDigest,
					snapshotKind: "scoped_worktree",
				},
			});
		} catch (error) {
			try {
				await runtimeTargetProvider?.dispose?.();
			} finally {
				await fullSourceSnapshot.cleanup();
				fullSourceSnapshot = null;
				runtimeTargetProvider = undefined;
				runtimeProviderDispose = undefined;
			}
			throw error;
		}
	}

	const baseScanPreflight = await runScanPreflight({
		profile,
		steps: profileSteps,
		projectId: params.projectId,
		repoPath: params.repoPath,
		execution,
		mode: profile.strictness === "strict" ? "enforced" : params.preflightMode,
		consentProjectCodeExecution: params.consentProjectCodeExecution,
		allowDirtySource: requestedTarget.kind === "working_tree",
		imageRef: params.imageRef,
		imageTar: params.imageTar,
		attestationSubject: params.attestationSubject,
		attestationBundle: params.attestationBundle,
		trustPolicy: params.trustPolicy,
		targetPlan: runtimeTargetProvider?.plan,
		isolatedRuntimeProviderAvailable: Boolean(runtimeTargetProvider),
	});
	const runtimeIsolationPlanning =
		runtimeTargetProvider?.runtimeIsolationPlanning;
	const runtimeIsolation = runtimeIsolationExecutionPlanBinding(
		runtimeIsolationPlanning,
	);
	const scanPreflight = runtimeIsolationPlanning
		? buildRuntimeIsolationPreflight({
				base: baseScanPreflight,
				planning: runtimeIsolationPlanning,
				networkReady: true,
				cleanupReady: true,
			})
		: baseScanPreflight;
	const preflightBindingChanged = Boolean(
		params.expectedPreflightBindingHash &&
			params.expectedPreflightBindingHash !== scanPreflight.bindingHash,
	);
	const executionPlan = buildScanExecutionPlan({
		scanRunId: scanRun.id,
		projectId: params.projectId,
		profile,
		steps: profileSteps,
		preflight: scanPreflight,
		technologyRegistryDigest: technologyAnalysis.capabilityPlan.registryDigest,
		sourceSnapshotDigest: params.sourceSnapshotDigest ?? fullScanTarget?.digest,
		runner: execution.runner,
		schemaVersion: runtimeIsolation ? 3 : params.executionPlanSchemaVersion,
		runtimeIsolation,
	});
	const executionPlanChanged = Boolean(
		params.expectedPlanHash &&
			params.expectedPlanHash !== executionPlan.planHash,
	);
	await scanRepo.saveExecutionPlan({
		scanRunId: scanRun.id,
		projectId: params.projectId,
		profileId: profile.id,
		strictness: executionPlan.strictness,
		planHash: executionPlan.planHash,
		plan: executionPlan,
	});
	const professionalCatalogEntry = getCatalogEntry("professional-full");
	const professionalRunGroupPlan =
		executionPlan.schemaVersion === 2 &&
		profile.id === "full-security-scan" &&
		professionalCatalogEntry
			? buildProfessionalRunGroupPlan({
					parentScanRunId: scanRun.id,
					executionPlan,
					catalogEntryHash: hashCatalogEntry(professionalCatalogEntry),
					createdAt: executionPlan.createdAt,
				})
			: null;
	await scanRepo.mergeScanRunMetadata(scanRun.id, {
		scanPreflight,
		preflightBindingHash: scanPreflight.bindingHash,
		executionPlan,
		...(professionalRunGroupPlan ? { professionalRunGroupPlan } : {}),
	});
	await scanRepo.createScanEvent({
		scanRunId: scanRun.id,
		level:
			scanPreflight.status === "ready" &&
			!preflightBindingChanged &&
			!executionPlanChanged
				? "info"
				: "warn",
		eventType: executionPlanChanged
			? "scan.plan_changed"
			: preflightBindingChanged
				? "scan.preflight_changed"
				: "scan.preflight_completed",
		message: executionPlanChanged
			? "Scan execution plan changed after preview."
			: preflightBindingChanged
				? "Scan preflight binding changed after preview."
				: `Scan preflight completed with status: ${scanPreflight.status}.`,
		data: {
			status: scanPreflight.status,
			mode: scanPreflight.mode,
			bindingHash: scanPreflight.bindingHash,
			planHash: executionPlan.planHash,
			limitationCodes: scanPreflight.limitationCodes,
		},
	});
	if (
		executionPlanChanged ||
		preflightBindingChanged ||
		preflightBlocksExecution(scanPreflight) ||
		(profile.strictness === "strict" && executionPlanBlocks(executionPlan))
	) {
		if (fullSourceSnapshot) {
			await runtimeProviderDispose?.();
			runtimeProviderDispose = undefined;
			await fullSourceSnapshot.cleanup();
			fullSourceSnapshot = null;
		}
		const coverageLedger = buildCoverageLedger({
			profile,
			planHash: executionPlan.planHash,
			derivedAt: new Date().toISOString(),
			stepResults: [],
		});
		const professionalRunGroupAssessment =
			professionalRunGroupPlan && coverageLedger
				? assessProfessionalRunGroup({
						plan: professionalRunGroupPlan,
						ledger: coverageLedger,
						childResults: [],
					})
				: null;
		const terminationReason = executionPlanChanged
			? "plan_changed"
			: preflightBindingChanged
				? "preflight_changed"
				: "preflight_failed";
		const summaryMsg = executionPlanChanged
			? "Scan failed because the execution plan changed after preview."
			: preflightBindingChanged
				? "Scan failed because the preflight binding changed after preview."
				: "Scan failed because a required preflight check was blocked.";
		await scanRepo.updateScanRunStatus(scanRun.id, "failed", {
			summary: summaryMsg,
			profileOutcome: "blocked",
			metadata: {
				...scanRun.metadata,
				...initialMetadata,
				scanPreflight,
				preflightBindingHash: scanPreflight.bindingHash,
				profileOutcome: "blocked",
				executionPlan,
				terminationReason,
				profileLimitationCodes: [
					...new Set([
						...(profile.coverageGaps ?? []),
						...(coverageLedger?.entries.flatMap((entry) => entry.reasonCodes) ??
							[]),
						...scanPreflight.limitationCodes,
						terminationReason,
					]),
				].sort(),
				...(coverageLedger ? { coverageLedger } : {}),
				...(professionalRunGroupAssessment
					? { professionalRunGroupAssessment }
					: {}),
			},
		});
		await scanRepo.createScanEvent({
			scanRunId: scanRun.id,
			level: "error",
			eventType: "scan.failed",
			message: summaryMsg,
			data: { terminationReason },
		});
		return {
			ok: false,
			scanRunId: scanRun.id,
			profileId: params.profileId,
			canonicalProfileId: resolution.canonicalProfileId,
			executionProfileId,
			resultPolicy: resolution.resultPolicy,
			gateDecision: "blocked",
			status: "failed",
			profileOutcome: "blocked",
			runner: execution.runner,
			message: summaryMsg,
			toolResults: [],
			stepResults: [],
		};
	}

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
		});
		if (
			profileInputSnapshot &&
			hashProfileInputs(profileInputSnapshot.bindings) !==
				scanPreflight.binding.profileInputsHash
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
					imageRef: params.imageRef,
					imageTar: params.imageTar,
					attestationSubject: params.attestationSubject,
					attestationBundle: params.attestationBundle,
					trustPolicy: params.trustPolicy,
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

	// Determine profile outcome
	const runtimeAssessmentCoverage =
		aggregateRuntimeAssessmentCoverage(stepResults);
	const runtimeCoverageLimited = runtimeAssessmentCoverage.steps.some(
		(step) =>
			step.applicability === "applicable" && step.coverageEffect !== "covered",
	);
	const semgrepCapability = technologyAnalysis.capabilityPlan.steps.find(
		(step) => step.stepId === "semgrep",
	);
	const sourceSastApplicability = resolveSourceSastApplicability({
		hasSourceFiles: technologyAnalysis.capabilityPlan.languages.length > 0,
		hasSupportedLanguage:
			technologyAnalysis.capabilityPlan.languages.length > 0,
		rulesetAvailable: Boolean(semgrepCapability?.pluginIds.length),
		adapterAvailable: staticScannerAdapterRegistry.has("semgrep"),
	});
	const sourceSastCoverage = resolveSourceSastCoverage(
		profile,
		stepResults,
		sourceSastApplicability,
	);
	const sourceSastLimited = sourceSastCoverage?.coverageEffect === "gap";
	const coverageLedger = buildCoverageLedger({
		profile,
		planHash: executionPlan.planHash,
		derivedAt: new Date().toISOString(),
		stepResults,
	});
	const normalizedStepResults = stepResults.map(normalizeProfileStepResult);
	const professionalRunGroupAssessment =
		professionalRunGroupPlan && coverageLedger
			? assessProfessionalRunGroup({
					plan: professionalRunGroupPlan,
					ledger: coverageLedger,
					childResults: normalizedStepResults,
				})
			: null;
	const professionalRunGroupQualification =
		professionalRunGroupPlan &&
		professionalRunGroupAssessment?.technicalCompletion &&
		coverageLedger
			? qualifyProfessionalRunGroup({
					plan: professionalRunGroupPlan,
					ledger: coverageLedger,
					assessment: professionalRunGroupAssessment,
					qualifiedAt: new Date().toISOString(),
				})
			: null;
	const professionalRunGroupPhase56Handoff = professionalRunGroupQualification
		? buildProfessionalRunGroupPhase56Handoff({
				qualification: professionalRunGroupQualification,
				preparedAt: new Date().toISOString(),
			})
		: null;
	const ledgerLimited = Boolean(
		coverageLedger?.entries.some((entry) => entry.coverageEffect !== "covered"),
	);
	const profileLimitationCodes = [
		...new Set([
			...(profile.coverageGaps ?? []),
			...(coverageLedger?.entries.flatMap((entry) => entry.reasonCodes) ?? []),
			...(sourceSastCoverage?.limitationCodes ?? []),
			...scanPreflight.limitationCodes,
		]),
	].sort();
	let profileOutcome: "completed" | "completed_with_warnings" | "failed" =
		"completed";
	let finalScanStatus: "completed" | "failed" = "completed";

	if (profileFailingToolFailed) {
		// A fail_profile tool failed, so the overall outcome is failed.
		profileOutcome = "failed";
		finalScanStatus = "failed";
	} else if (
		optionalToolFailed ||
		runtimeCoverageLimited ||
		sourceSastLimited ||
		ledgerLimited
	) {
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
	const pluginExecutionSummary = buildPluginExecutionSummary({
		detections: technologyAnalysis.detections,
		capabilityPlan: technologyAnalysis.capabilityPlan,
		stepResults,
	});
	const gateEvaluation = evaluateScanGate({
		resultPolicy: resolution.resultPolicy,
		gateThreshold: resolution.gateSeverityThreshold,
		profileOutcome,
		findings: await new FindingRepository(params.db).listFindings(scanRun.id),
	});

	await scanRepo.updateScanRunStatus(scanRun.id, finalScanStatus, {
		summary: summaryMsg,
		profileOutcome,
		metadata: {
			...scanRun.metadata,
			profileId: params.profileId,
			canonicalProfileId: resolution.canonicalProfileId,
			executionProfileId: resolution.executionProfileId,
			profileResolution: resolution,
			catalogEntry,
			profileVersion: 1,
			resolvedProfile: profile,
			resolvedProfileHash,
			profileLimitationCodes,
			...(sourceSastCoverage ? { sourceSastCoverage } : {}),
			...(coverageLedger ? { coverageLedger } : {}),
			...(professionalRunGroupAssessment
				? { professionalRunGroupAssessment }
				: {}),
			...(professionalRunGroupQualification
				? { professionalRunGroupQualification }
				: {}),
			...(professionalRunGroupPhase56Handoff
				? { professionalRunGroupPhase56Handoff }
				: {}),
			normalizedStepResults,
			scope: resolvedScope,
			profileOutcome,
			gateEvaluation,
			continueOnToolFailure,
			runner: execution.runner,
			toolOrder: profile.tools.map((t) => t.toolId),
			stepOrder,
			toolResults,
			stepResults,
			runtimeAssessmentCoverage,
			technologyPlugins: pluginExecutionSummary,
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
		level:
			profileOutcome === "failed"
				? "error"
				: gateEvaluation.gateDecision === "fail"
					? "warn"
					: "info",
		eventType: profileOutcome === "failed" ? "scan.failed" : "scan.completed",
		message: summaryMsg,
		data: { gateEvaluation },
	});

	const ok =
		profileOutcome !== "failed" &&
		gateEvaluation.gateDecision !== "fail" &&
		gateEvaluation.gateDecision !== "blocked";
	const message = summaryMsg;

	return {
		ok,
		scanRunId: scanRun.id,
		profileId: params.profileId,
		canonicalProfileId: resolution.canonicalProfileId,
		executionProfileId,
		resultPolicy: resolution.resultPolicy,
		gateDecision: gateEvaluation.gateDecision,
		status: finalScanStatus,
		profileOutcome,
		runner: execution.runner,
		message,
		toolResults,
		stepResults,
	};
}

export async function cleanupExecutionWorkspaces(params: {
	scanRepo: {
		createScanEvent: (
			input: Parameters<ScanRepository["createScanEvent"]>[0],
		) => Promise<unknown>;
		mergeScanRunMetadata: (
			scanRunId: string,
			metadata: Record<string, unknown>,
		) => Promise<unknown>;
	};
	scanRunId: string;
	workspaces: Array<{ kind: string; cleanup: () => Promise<void> }>;
}): Promise<void> {
	if (params.workspaces.length === 0) return;
	const receipts: Array<{
		kind: string;
		status: "completed" | "failed";
		completedAt: string;
		failureCode?: string;
	}> = [];
	const failureCodes: string[] = [];
	for (const workspace of params.workspaces) {
		const completedAt = new Date().toISOString();
		try {
			await workspace.cleanup();
			receipts.push({
				kind: workspace.kind,
				status: "completed",
				completedAt,
			});
		} catch {
			const failureCode = `${workspace.kind}_cleanup_failed`;
			failureCodes.push(failureCode);
			receipts.push({
				kind: workspace.kind,
				status: "failed",
				completedAt,
				failureCode,
			});
			try {
				await params.scanRepo.createScanEvent({
					scanRunId: params.scanRunId,
					level: "error",
					eventType: `${workspace.kind}.cleanup_failed`,
					message: `Temporary ${workspace.kind} cleanup failed.`,
				});
			} catch {
				// Continue cleanup; the persisted receipt remains the source of truth.
			}
		}
	}
	try {
		await params.scanRepo.mergeScanRunMetadata(params.scanRunId, {
			workspaceCleanupReceipts: receipts,
		});
	} catch {
		throw new Error("workspace_cleanup_receipt_not_persisted");
	}
	if (failureCodes.length > 0) {
		throw new Error(failureCodes.sort().join(","));
	}
}
