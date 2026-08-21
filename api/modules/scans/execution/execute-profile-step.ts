import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import { discoverRepositoryApiSchema } from "../../api-schema-fuzz/schema-discovery";
import type { PreparedRuntimeTarget } from "../../dast/runtime-target-provider";
import type { DiffScanPlan } from "../diff-scan-plan";
import type { DiffSnapshot } from "../diff-snapshot";
import {
	runDastStepIntoExistingScan,
	runRuntimeScannerIntoExistingScan,
	runSchemaScannerIntoExistingScan,
	runToolIntoExistingScan,
	type ScanProfileStepResult,
	type ToolResult,
} from "../profile-runner";
import type { ExecuteProfileStepsParams } from "../profile-step-orchestrator-types";
import { resolveStaticScannerDiffExecution } from "../static-scanner-adapter";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { withMandatoryExcludes } from "../target-scope";

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
		if (
			step.kind === "static_tool" ||
			step.kind === "sbom_export" ||
			step.kind === "container_image_scan"
		) {
			return await executeAdapterStep(params);
		}
		if (step.kind === "dast") {
			return await executeDastStep(params);
		}
		if (step.kind === "runtime_scanner") {
			return await executeRuntimeStep(params);
		}
		if (step.kind === "api_schema_scan") {
			return await executeSchemaStep(params);
		}
		throw new Error(`Unsupported profile step: ${stepId}`);
	} catch (err: unknown) {
		const error = err instanceof Error ? err.message : String(err);
		const failed = failureDelta(step, stepId, error, failureFailsProfile);
		if (failed) return failed;
		throw err;
	}
}

function failureDelta(
	step: ScanProfileStep,
	stepId: string,
	error: string,
	failureFailsProfile: boolean,
): ProfileStepExecution | null {
	const flags = {
		optionalToolFailed: !failureFailsProfile,
		profileFailingToolFailed: failureFailsProfile,
	};
	if (step.kind === "runtime_scanner" || step.kind === "api_schema_scan") {
		return {
			...flags,
			toolResults: [],
			stepResults: [
				{
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
				},
			],
		};
	}
	if (step.kind === "dast") {
		return {
			...flags,
			toolResults: [],
			stepResults: [
				{
					kind: "dast",
					profileId: step.profileId,
					required: step.required,
					status: "failed",
					outcome: "error",
					findingCount: 0,
					dastRunId: null,
					targetOrigin: null,
					error,
				},
			],
		};
	}
	if (
		step.kind === "static_tool" ||
		step.kind === "sbom_export" ||
		step.kind === "container_image_scan"
	) {
		const toolId = step.kind === "static_tool" ? step.toolId : "trivy";
		const toolResult: ToolResult = {
			toolId,
			toolRunId: null,
			required: step.required,
			status: "failed",
			findingCount: 0,
			exitCode: null,
			error,
			applicability: "applicable",
			reasonCode: "execution_failed",
			coverageEffect: "gap",
			artifactIds: [],
		};
		return {
			...flags,
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
								status: "failed",
								applicability: "not_applicable",
								reasonCode: error.includes("image_input_not_provided")
									? "image_input_not_provided"
									: "execution_failed",
								coverageEffect: "gap",
								findingCount: 0,
								error,
								artifactIds: [],
							},
						],
		};
	}
	return null;
}

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
	const baseOptions = {
		...(("options" in step ? step.options : undefined) ?? {}),
		...(step.kind === "sbom_export" ? { mode: "fs-sbom" } : {}),
		...(step.kind === "container_image_scan"
			? {
					mode: "image",
					imageRef: scope.imageRef,
					imageTar: scope.imageTar,
				}
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
		execution: params.scope.execution,
		allowedPaths: target.targetConfig.allowedPathsJson,
		excludedPaths: target.targetConfig.excludedPathsJson,
		maxRequests: runtimeOptions?.maxRequests,
		rateLimitPerSec: runtimeOptions?.rateLimitPerSec,
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
	const discovery = await discoverRepositoryApiSchema(params.scope.repoPath);
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
	const schemaOptions = step.options as
		| { maxRequests?: number; rateLimitPerSec?: number }
		| undefined;
	const schemaResult = await runSchemaScannerIntoExistingScan({
		db: params.scope.db,
		projectId: params.scope.projectId,
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
