import path from "node:path";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import { discoverRepositoryApiSchema } from "../../api-schema-fuzz/schema-discovery";
import type { PreparedRuntimeTarget } from "../../dast/runtime-target-provider";
import { resolveRepositoryRelativeFile } from "../attestation/attestation-inputs";
import { resolveStaticScannerDiffExecution } from "../static-scanner-adapter";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { withMandatoryExcludes } from "../target-scope";
import { executeAttestationStep } from "./execute-attestation-step";
import { failureDelta } from "./execute-profile-step-failure";
import type { DiffScanPlan } from "./diff/diff-scan-plan";
import type { DiffSnapshot } from "./diff/diff-snapshot";
import {
	runDastStepIntoExistingScan,
	runRuntimeScannerIntoExistingScan,
	runSchemaScannerIntoExistingScan,
	runToolIntoExistingScan,
	type ScanProfileStepResult,
	type ToolResult,
} from "./profile-runner";
import type { ExecuteProfileStepsParams } from "./profile-step-orchestrator-types";

export type ProfileStepExecution = {
	toolResults: ToolResult[];
	stepResults: ScanProfileStepResult[];
	optionalToolFailed: boolean;
	profileFailingToolFailed: boolean;
};

export async function executeProfileStep(params: {
	step: ScanProfileStep;
	stepId: string;
	resolvedTimeout: number;
	failureFailsProfile: boolean;
	diffPlan: DiffScanPlan | null;
	diffSnapshot: DiffSnapshot | null;
	sharesRuntimeTarget: boolean;
	ensureSharedRuntimeTarget: () => Promise<PreparedRuntimeTarget>;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, failureFailsProfile } = params;
	try {
		const runner = profileStepRunnerRegistry[step.kind];
		if (!runner) throw new Error(`Unsupported profile step: ${stepId}`);
		return await runner(params);
	} catch (err: unknown) {
		const failed = await failureDelta(
			step,
			stepId,
			err,
			failureFailsProfile,
			params.scope,
		);
		if (failed) return failed;
		throw err;
	}
}

type ProfileStepRunner = (params: {
	step: ScanProfileStep;
	stepId: string;
	resolvedTimeout: number;
	failureFailsProfile: boolean;
	diffPlan: DiffScanPlan | null;
	diffSnapshot: DiffSnapshot | null;
	sharesRuntimeTarget: boolean;
	ensureSharedRuntimeTarget: () => Promise<PreparedRuntimeTarget>;
	scope: ExecuteProfileStepsParams;
}) => Promise<ProfileStepExecution>;

/**
 * The registry is the single dispatch point for every profile step kind. New
 * adapters must register here rather than introduce another orchestration path.
 */
export const profileStepRunnerRegistry: Record<
	ScanProfileStep["kind"],
	ProfileStepRunner
> = {
	static_tool: executeAdapterStep,
	sbom_export: executeAdapterStep,
	container_image_scan: executeAdapterStep,
	dast: executeDastStep,
	runtime_scanner: executeRuntimeStep,
	api_schema_scan: executeSchemaStep,
	attestation_verify: executeAttestationStep,
};

async function executeAdapterStep(params: {
	step: ScanProfileStep;
	stepId: string;
	resolvedTimeout: number;
	failureFailsProfile: boolean;
	diffPlan: DiffScanPlan | null;
	diffSnapshot: DiffSnapshot | null;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, resolvedTimeout, diffPlan, diffSnapshot, scope } =
		params;
	if (
		step.kind !== "static_tool" &&
		step.kind !== "sbom_export" &&
		step.kind !== "container_image_scan"
	) {
		throw new Error(`Unsupported profile step: ${stepId}`);
	}
	const toolId = step.kind === "static_tool" ? step.toolId : "trivy";
	const scannerAdapter = staticScannerAdapterRegistry.require(toolId);
	const diffExecution =
		diffPlan && step.kind === "static_tool"
			? resolveStaticScannerDiffExecution(scannerAdapter, diffPlan.scanPaths)
			: null;
	const diffInputKind =
		diffExecution?.inputKind ?? scannerAdapter.manifest.diffInput;
	const toolRepoPath =
		diffPlan && step.kind === "static_tool"
			? diffInputKind === "full_snapshot"
				? diffSnapshot?.projectPath
				: diffExecution?.workspace === "trivy"
					? diffSnapshot?.trivyWorkspacePath
					: diffSnapshot?.changedWorkspacePath
			: scope.repoPath;
	if (!toolRepoPath) {
		throw new Error(
			"snapshot_materialization_failed: scanner input is unavailable",
		);
	}
	const resolvedImageTar =
		step.kind === "container_image_scan" && scope.imageTar
			? await resolveRepositoryRelativeFile(
					scope.profileInputRepoPath,
					scope.imageTar,
					"image tar",
				)
			: undefined;
	const mavenResolverImageCheck = scope.scanPreflight.checks.find(
		(check) => check.id === "runtime:docker-image:maven-resolver",
	);
	const mavenResolverImageId = mavenResolverImageCheck?.evidenceRefs
		.find((reference) => reference.startsWith("docker-image-id:"))
		?.slice("docker-image-id:".length);
	const mavenResolverImageDigest = mavenResolverImageCheck?.evidenceRefs
		.find((reference) => reference.startsWith("docker-image:"))
		?.slice("docker-image:".length);
	const baseOptions = {
		...(("options" in step ? step.options : undefined) ?? {}),
		...(step.kind === "sbom_export" ? { mode: "fs-sbom" } : {}),
		...(step.kind === "container_image_scan"
			? {
					mode: "image",
					imageRef: scope.imageRef,
					imageTar: resolvedImageTar,
				}
			: {}),
		...(toolId === "osv"
			? {
					dependencyResolutionMode: scope.mavenProjectDetected
						? scope.dependencyResolutionMode
						: "offline",
					mavenResolverImage: scope.mavenResolverImage,
					mavenResolverImageId,
					mavenResolverImageDigest,
					mavenResolutionConfigDigest:
						scope.scanPreflight.checks.find(
							(check) => check.id === "static_tool:osv:maven-resolution-config",
						)?.observedDigest ?? undefined,
					mavenResolutionSourceDigest:
						scope.scanPreflight.checks.find(
							(check) => check.id === "static_tool:osv:maven-resolution-source",
						)?.observedDigest ?? undefined,
					mavenResolutionConfig: scope.mavenResolutionConfig,
				}
			: {}),
		...(toolId === "gitleaks" && diffSnapshot
			? { configPath: path.join(diffSnapshot.projectPath, ".gitleaks.toml") }
			: {}),
		scope: withMandatoryExcludes(scope.profile.scope),
		scopeSummary: scope.resolvedScope,
	};
	const toolOptions = scannerAdapter.extendProfileOptions
		? await scannerAdapter.extendProfileOptions({
				options: baseOptions,
				activeTechnologyPluginIds:
					scope.technologyAnalysis.capabilityPlan.activePluginIds,
			})
		: baseOptions;
	const toolRes = await runToolIntoExistingScan({
		db: scope.db,
		projectId: scope.projectId,
		scanRunId: scope.scanRun.id,
		toolId,
		options: toolOptions,
		artifactStorage: scope.artifactStorage,
		timeoutSec: resolvedTimeout,
		repoPath: toolRepoPath,
		execution: scope.execution,
		diffContext:
			diffPlan && step.kind === "static_tool"
				? {
						target: diffPlan.target,
						entries: diffPlan.manifest.entries,
						targetPaths: diffExecution?.targetPaths,
						inputKind: diffInputKind,
						contextFileCount:
							toolId === "trivy"
								? (diffSnapshot?.trivyContextFileCount ?? 0)
								: 0,
					}
				: undefined,
	});
	const diffApplicability =
		step.kind === "static_tool" && diffPlan
			? diffPlan.tools.find((tool) => tool.toolId === step.toolId)
			: null;
	const status = "completed" as const;
	const toolResult: ToolResult = {
		toolId,
		toolRunId: toolRes.toolRunId,
		required: step.required,
		status,
		findingCount: toolRes.findingCount,
		exitCode: toolRes.exitCode,
		error: null,
		applicability: "applicable",
		reasonCode: null,
		coverageEffect:
			toolRes.diffUnmappedFindingCount > 0
				? "partial"
				: (diffApplicability?.coverageEffect ?? "covered"),
		artifactIds: toolRes.artifactIds,
		metadata: diffPlan
			? {
					targetDigest: diffPlan.target.targetDigest,
					diffUnmappedFindingCount: toolRes.diffUnmappedFindingCount,
				}
			: undefined,
	};
	return {
		optionalToolFailed: toolRes.diffUnmappedFindingCount > 0,
		profileFailingToolFailed: false,
		toolResults: [toolResult],
		stepResults:
			step.kind === "static_tool"
				? [{ kind: "static_tool", ...toolResult }]
				: [
						{
							kind: step.kind,
							stepId,
							adapter: step.adapter,
							required: step.required,
							status,
							applicability: "applicable",
							reasonCode: null,
							coverageEffect: "covered",
							findingCount: toolRes.findingCount,
							error: null,
							artifactIds: toolRes.artifactIds,
						},
					],
	};
}

async function executeDastStep(params: {
	step: ScanProfileStep;
	failureFailsProfile: boolean;
	sharesRuntimeTarget: boolean;
	ensureSharedRuntimeTarget: () => Promise<PreparedRuntimeTarget>;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step } = params;
	if (step.kind !== "dast") {
		throw new Error("Unsupported profile step: dast");
	}
	const target = params.sharesRuntimeTarget
		? await params.ensureSharedRuntimeTarget()
		: undefined;
	const dastResult = await runDastStepIntoExistingScan({
		db: params.scope.db,
		projectId: params.scope.projectId,
		scanRunId: params.scope.scanRun.id,
		step,
		repoPath: params.scope.repoPath,
		timeoutSec: params.resolvedTimeout,
		createdByUserId: params.scope.createdByUserId,
		preparedAutoTarget: target,
		artifactStorage: params.scope.artifactStorage,
		consentProjectCodeExecution: params.scope.consentProjectCodeExecution,
	});
	const failed = dastResult.status === "failed";
	return {
		toolResults: [],
		stepResults: [dastResult],
		profileFailingToolFailed: failed && params.failureFailsProfile,
		optionalToolFailed:
			(failed && !params.failureFailsProfile) ||
			(!failed && dastResult.coverageStatus !== "covered"),
	};
}

async function executeRuntimeStep(params: {
	step: ScanProfileStep;
	stepId: string;
	failureFailsProfile: boolean;
	ensureSharedRuntimeTarget: () => Promise<PreparedRuntimeTarget>;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId } = params;
	if (step.kind !== "runtime_scanner") {
		throw new Error(`Unsupported profile step: ${stepId}`);
	}
	const target = await params.ensureSharedRuntimeTarget();
	if (
		target.runtimeNamespaceOwnerId &&
		!target.runtimeScannerImages?.[step.adapter]
	) {
		throw new Error("runtime_scanner_image_unavailable");
	}
	const runtimeOptions = step.options as
		| { maxRequests?: number; rateLimitPerSec?: number }
		| undefined;
	const runtimeResult = await runRuntimeScannerIntoExistingScan({
		db: params.scope.db,
		projectId: params.scope.projectId,
		scanRunId: params.scope.scanRun.id,
		adapter: step.adapter,
		targetOrigin: target.origin,
		artifactStorage: params.scope.artifactStorage,
		timeoutSec: params.resolvedTimeout,
		execution: runtimeScannerExecution(
			params.scope.execution,
			target.runtimeNamespaceOwnerId,
		),
		allowedPaths: target.targetConfig.allowedPathsJson,
		excludedPaths: target.targetConfig.excludedPathsJson,
		maxRequests: runtimeOptions?.maxRequests,
		rateLimitPerSec: runtimeOptions?.rateLimitPerSec,
		runtimeNamespaceOwnerId: target.runtimeNamespaceOwnerId,
		runtimeImage: target.runtimeScannerImages?.[step.adapter],
	});
	const runtimeFailed = Boolean(runtimeResult.error);
	return {
		toolResults: [],
		stepResults: [
			{
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
			},
		],
		profileFailingToolFailed: runtimeFailed && params.failureFailsProfile,
		optionalToolFailed: runtimeFailed && !params.failureFailsProfile,
	};
}

function runtimeScannerExecution(
	execution: ExecuteProfileStepsParams["execution"],
	runtimeNamespaceOwnerId: string | undefined,
) {
	if (!runtimeNamespaceOwnerId) return execution;
	return {
		...execution,
		runner: "docker" as const,
		docker: {
			...(execution.docker ?? {}),
			runtimeNamespaceOwnerId,
		},
	};
}

async function executeSchemaStep(params: {
	step: ScanProfileStep;
	stepId: string;
	failureFailsProfile: boolean;
	ensureSharedRuntimeTarget: () => Promise<PreparedRuntimeTarget>;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId } = params;
	if (step.kind !== "api_schema_scan") {
		throw new Error(`Unsupported profile step: ${stepId}`);
	}
	const discovery = await discoverRepositoryApiSchema(params.scope.repoPath, {
		includeAuthenticatedOperations: Boolean(params.scope.authContextId),
	});
	if (!discovery.applicable) {
		return {
			toolResults: [],
			stepResults: [
				{
					kind: step.kind,
					stepId,
					adapter: step.adapter,
					required: step.required,
					status: "skipped",
					applicability: "not_applicable",
					reasonCode: discovery.reasonCode ?? "schema_not_found",
					coverageEffect: "gap",
					findingCount: 0,
					error: null,
					artifactIds: [],
				},
			],
			profileFailingToolFailed: false,
			optionalToolFailed: false,
		};
	}
	const target = await params.ensureSharedRuntimeTarget();
	if (
		target.runtimeNamespaceOwnerId &&
		!target.runtimeScannerImages?.schemathesis
	) {
		throw new Error("runtime_scanner_image_unavailable");
	}
	const schemaOptions = step.options as
		| { maxRequests?: number; rateLimitPerSec?: number }
		| undefined;
	const schemaResult = await runSchemaScannerIntoExistingScan({
		db: params.scope.db,
		projectId: params.scope.projectId,
		createdByUserId: params.scope.createdByUserId ?? undefined,
		scanRunId: params.scope.scanRun.id,
		repoPath: params.scope.repoPath,
		targetOrigin: target.origin,
		discovery,
		artifactStorage: params.scope.artifactStorage,
		timeoutSec: params.resolvedTimeout,
		execution: params.scope.execution,
		allowedPaths: target.targetConfig.allowedPathsJson,
		excludedPaths: target.targetConfig.excludedPathsJson,
		maxRequests: schemaOptions?.maxRequests,
		rateLimitPerSec: schemaOptions?.rateLimitPerSec,
		runtimeNamespaceOwnerId: target.runtimeNamespaceOwnerId,
		runtimeImage: target.runtimeScannerImages?.schemathesis,
		authContextRepository: params.scope.authContextRepository,
		authContextId: params.scope.authContextId,
		identityRole: params.scope.identityRole,
	});
	const notApplicable = !schemaResult.applicable;
	const schemaFailed = Boolean(schemaResult.error);
	return {
		toolResults: [],
		stepResults: [
			{
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
			},
		],
		profileFailingToolFailed: schemaFailed && params.failureFailsProfile,
		optionalToolFailed: schemaFailed && !params.failureFailsProfile,
	};
}
