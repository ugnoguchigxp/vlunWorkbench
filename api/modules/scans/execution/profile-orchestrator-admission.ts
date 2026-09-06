import type { ScanProfile } from "../../../../shared/schemas/scan-profile.schema";
import {
	buildRuntimeIsolationPreflight,
	runtimeIsolationExecutionPlanBinding,
} from "../../runtime-isolation/runtime-isolation-preflight";
import { runtimeScannerImageRequirementsForSteps } from "../../runtime-isolation/runtime-isolation-provider-factory";
import { buildCoverageLedger } from "../coverage/coverage-ledger";
import type { resolveScanScope } from "../target-scope";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import type { DiffScanPlan } from "./diff/diff-scan-plan";
import type { resolveFullScanTarget } from "./full-scan-target";
import {
	type FullSourceSnapshot,
	materializeScopedSourceSnapshot,
} from "./lifecycle/full-source-snapshot";
import type { ProfileOrchestratorParams } from "./profile-orchestrator";
import type { ProfileScanResult, resolveProfileSteps } from "./profile-runner";
import {
	buildScanExecutionPlan,
	executionPlanBlocks,
} from "./scan-execution-plan-builder";
import { preflightBlocksExecution, runScanPreflight } from "./scan-preflight";
import type { ScanRepository } from "../repositories";
import type { analyzeProjectCapabilities } from "../../project-capabilities/plugin-detector";
import type { resolveProfileSelection } from "../profile-resolution";

export async function prepareProfileScanAdmission(input: {
	params: ProfileOrchestratorParams;
	scanRepo: ScanRepository;
	initialMetadata: Record<string, unknown>;
	resolution: ReturnType<typeof resolveProfileSelection>["resolution"];
	profileSteps: ReturnType<typeof resolveProfileSteps>;
	fullScanTarget: Awaited<ReturnType<typeof resolveFullScanTarget>> | null;
	resolvedScope: Awaited<ReturnType<typeof resolveScanScope>>;
	profile: ScanProfile;
	execution: ToolExecutionConfig;
	requestedTarget: NonNullable<ProfileOrchestratorParams["target"]>;
	mavenProjectDetected: boolean;
	mavenResolutionApplicable: boolean;
	diffPlan: DiffScanPlan | null;
	technologyAnalysis: Awaited<ReturnType<typeof analyzeProjectCapabilities>>;
	executionProfileId: string;
}) {
	const {
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
	} = input;
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
				scannerImageRequirements:
					runtimeScannerImageRequirementsForSteps(profileSteps),
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
		slsaProvenance: params.slsaProvenance,
		slsaPolicy: params.slsaPolicy,
		authContextId: params.authContextId,
		identityRole: params.identityRole,
		dependencyResolutionMode: params.dependencyResolutionMode ?? "offline",
		mavenResolverImage: params.mavenResolverImage,
		mavenResolutionConfig: params.mavenResolutionConfig,
		mavenProjectDetected,
		mavenResolutionApplicable,
		staticScannerPaths:
			diffPlan?.scanPaths ??
			technologyAnalysis.context.inventory.map((entry) => entry.path),
		targetPlan: runtimeTargetProvider?.plan,
		runtimeDockerImages: runtimeTargetProvider?.preflightDockerImages,
		runtimeScannerImages: runtimeTargetProvider?.runtimeScannerImages,
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
	await scanRepo.mergeScanRunMetadata(scanRun.id, {
		scanPreflight,
		preflightBindingHash: scanPreflight.bindingHash,
		executionPlan,
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
			plannedSteps: executionPlan.steps,
			derivedAt: new Date().toISOString(),
			stepResults: [],
		});
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
			blockedResult: {
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
			} satisfies ProfileScanResult,
		};
	}
	return {
		blockedResult: null,
		scanRun,
		fullSourceSnapshot,
		runtimeTargetProvider,
		runtimeProviderDispose,
		scanPreflight,
		executionPlan,
	};
}
