import path from "node:path";
import type { ScanProfileStep } from "../../../../shared/schemas/scan-profile.schema";
import { discoverRepositoryApiSchema } from "../../api-schema-fuzz/schema-discovery";
import type { PreparedRuntimeTarget } from "../../dast/runtime-target-provider";
import { RuntimeTargetPreparationError } from "../../runtime-isolation/runtime-failure";
import {
	resolveAttestationInputPaths,
	resolveRepositoryRelativeFile,
	resolveSlsaProvenanceInputPaths,
} from "../attestation/attestation-inputs";
import {
	COSIGN_TRUSTED_ROOT_CONTAINER_PATH,
	COSIGN_TRUSTED_ROOT_REPOSITORY_PATH,
	CosignAttestationProvider,
	isCosignVersionSafe,
	parseCosignVersion,
} from "../attestation/cosign-attestation-provider";
import {
	parseSlsaVerifierVersion,
	SLSA_VERIFIER_VERSION,
	SlsaProvenanceProvider,
} from "../attestation/slsa-provenance-provider";
import { ArtifactRepository } from "../repositories";
import { resolveStaticScannerDiffExecution } from "../static-scanner-adapter";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { withMandatoryExcludes } from "../target-scope";
import {
	checkToolVersion,
	getCleanEnv,
	runToolProcess,
} from "../tools/tool-process-runner";
import type { DiffScanPlan } from "./diff/diff-scan-plan";
import type { DiffSnapshot } from "./diff/diff-snapshot";
import { ScanArtifactSink } from "./lifecycle/artifact-sink";
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

async function failureDelta(
	step: ScanProfileStep,
	stepId: string,
	error: unknown,
	failureFailsProfile: boolean,
	scope: ExecuteProfileStepsParams,
): Promise<ProfileStepExecution | null> {
	const runtimeFailure =
		error instanceof RuntimeTargetPreparationError ? error : null;
	const diagnosticArtifactIds = runtimeFailure?.input.evidence
		? await persistRuntimeDiagnostic(scope, runtimeFailure).catch(() => [])
		: [];
	runtimeFailure?.attachDiagnosticArtifactIds(diagnosticArtifactIds);
	const errorMessage =
		runtimeFailure?.message ??
		(error instanceof Error ? error.message : String(error));
	const reasonCode =
		runtimeFailure?.input.reasonCode ??
		(errorMessage.includes("policy_rejected")
			? "policy_rejected"
			: "execution_failed");
	const flags = {
		optionalToolFailed: !failureFailsProfile,
		profileFailingToolFailed: failureFailsProfile,
	};
	if (
		step.kind === "runtime_scanner" ||
		step.kind === "api_schema_scan" ||
		step.kind === "attestation_verify"
	) {
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
					reasonCode,
					coverageEffect: "gap",
					findingCount: 0,
					error: errorMessage,
					artifactIds: diagnosticArtifactIds,
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
					reasonCode,
					findingCount: 0,
					dastRunId: null,
					targetOrigin: null,
					error: errorMessage,
					artifactIds: diagnosticArtifactIds,
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
			error: errorMessage,
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
								reasonCode: errorMessage.includes("image_input_not_provided")
									? "image_input_not_provided"
									: "execution_failed",
								coverageEffect: "gap",
								findingCount: 0,
								error: errorMessage,
								artifactIds: diagnosticArtifactIds,
							},
						],
		};
	}
	return null;
}

async function persistRuntimeDiagnostic(
	scope: ExecuteProfileStepsParams,
	failure: RuntimeTargetPreparationError,
): Promise<string[]> {
	const evidence = failure.input.evidence;
	if (!evidence) return [];
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{
			scanRunId: scope.scanRun.id,
			kind: "scan",
			id: `runtime-${evidence.bundleId}`,
		},
	);
	const artifact = await sink.saveText({
		role: "runtime_diagnostic",
		format: "json",
		content: JSON.stringify(evidence, null, 2),
		metadata: {
			schemaVersion: evidence.schemaVersion,
			reasonCode: failure.input.reasonCode,
			redacted: evidence.redacted,
		},
	});
	return [artifact.id];
}

async function executeAttestationStep(params: {
	step: ScanProfileStep;
	stepId: string;
	failureFailsProfile: boolean;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, scope } = params;
	if (step.kind !== "attestation_verify") {
		throw new Error(`Unsupported profile step: ${stepId}`);
	}
	if (step.adapter === "slsa-verifier") {
		return executeSlsaAttestationStep({ ...params, step });
	}
	if (
		!scope.attestationSubject ||
		!scope.attestationBundle ||
		!scope.trustPolicy
	) {
		throw new Error("attestation_input_missing");
	}
	const observedCosignVersion = await checkToolVersion("cosign", ["version"], {
		execution: scope.execution,
	});
	if (!isCosignVersionSafe(observedCosignVersion)) {
		throw new Error("scanner_version_vulnerable:cosign");
	}
	const preflightCosignVersion = scope.scanPreflight.checks.find(
		(check) =>
			check.stepId === stepId &&
			check.kind === "binary_version" &&
			check.scannerId === "cosign",
	)?.observedVersion;
	if (
		preflightCosignVersion &&
		String(parseCosignVersion(preflightCosignVersion)) !==
			String(parseCosignVersion(observedCosignVersion))
	) {
		throw new Error("scanner_version_mismatch:cosign");
	}
	const paths = await resolveAttestationInputPaths({
		repoPath: scope.profileInputRepoPath,
		subject: scope.attestationSubject,
		bundle: scope.attestationBundle,
		trustPolicy: scope.trustPolicy,
	});
	const provider = new CosignAttestationProvider(
		async ({ binary, args, timeoutSec }) => {
			const result = await runToolProcess(binary, args, {
				execution: scope.execution,
				repoPath: scope.profileInputRepoPath,
				timeoutSec: Math.min(timeoutSec, params.resolvedTimeout),
				env: getCleanEnv(),
			});
			return { ok: result.ok, exitCode: result.exitCode };
		},
	);
	const receipt = await provider.verify({
		...paths,
		trustedRootPath:
			scope.execution.runner === "docker"
				? COSIGN_TRUSTED_ROOT_CONTAINER_PATH
				: path.resolve(process.cwd(), COSIGN_TRUSTED_ROOT_REPOSITORY_PATH),
		timeoutSec: params.resolvedTimeout,
	});
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{ scanRunId: scope.scanRun.id, kind: "scan", id: "attestation" },
	);
	const artifact = await sink.saveText({
		role: "raw_result",
		format: "json",
		content: JSON.stringify(receipt, null, 2),
		metadata: {
			adapter: "cosign",
			offline: true,
			trustedRoot: "pinned-scanner-data",
		},
	});
	const failed = !receipt.verified;
	return {
		toolResults: [],
		stepResults: [
			{
				kind: "attestation_verify",
				stepId,
				adapter: "cosign",
				required: step.required,
				status: failed ? "failed" : "completed",
				applicability: "applicable",
				reasonCode: failed ? "attestation_verification_failed" : null,
				coverageEffect: failed ? "gap" : "covered",
				findingCount: 0,
				error: failed
					? "Cosign could not verify the supplied attestation."
					: null,
				artifactIds: [artifact.id],
				metadata: { receipt },
			},
		],
		profileFailingToolFailed: failed && params.failureFailsProfile,
		optionalToolFailed: failed && !params.failureFailsProfile,
	};
}

async function executeSlsaAttestationStep(params: {
	step: Extract<ScanProfileStep, { kind: "attestation_verify" }>;
	stepId: string;
	failureFailsProfile: boolean;
	resolvedTimeout: number;
	scope: ExecuteProfileStepsParams;
}): Promise<ProfileStepExecution> {
	const { step, stepId, scope } = params;
	if (
		step.adapter !== "slsa-verifier" ||
		!scope.attestationSubject ||
		!scope.slsaProvenance ||
		!scope.slsaPolicy
	) {
		throw new Error("attestation_input_missing");
	}
	if (
		scope.execution.runner === "docker" &&
		scope.execution.docker?.networkMode !== "default"
	) {
		throw new Error("slsa_trust_root_network_required");
	}
	const observedVersion = await checkToolVersion("slsa-verifier", ["version"], {
		execution: scope.execution,
	});
	if (parseSlsaVerifierVersion(observedVersion) !== SLSA_VERIFIER_VERSION) {
		throw new Error("scanner_version_mismatch:slsa-verifier");
	}
	const preflightVersion = scope.scanPreflight.checks.find(
		(check) =>
			check.stepId === stepId &&
			check.kind === "binary_version" &&
			check.scannerId === "slsa-verifier",
	)?.observedVersion;
	if (
		preflightVersion &&
		parseSlsaVerifierVersion(preflightVersion) !==
			parseSlsaVerifierVersion(observedVersion)
	) {
		throw new Error("scanner_version_mismatch:slsa-verifier");
	}
	const paths = await resolveSlsaProvenanceInputPaths({
		repoPath: scope.profileInputRepoPath,
		subject: scope.attestationSubject,
		provenance: scope.slsaProvenance,
		policy: scope.slsaPolicy,
	});
	const provider = new SlsaProvenanceProvider(
		async ({ binary, args, timeoutSec }) => {
			const result = await runToolProcess(binary, args, {
				execution: scope.execution,
				repoPath: scope.profileInputRepoPath,
				timeoutSec: Math.min(timeoutSec, params.resolvedTimeout),
				env: getCleanEnv(),
			});
			return { ok: result.ok, exitCode: result.exitCode };
		},
	);
	const receipt = await provider.verify({
		...paths,
		timeoutSec: params.resolvedTimeout,
	});
	const sink = new ScanArtifactSink(
		scope.artifactStorage,
		new ArtifactRepository(scope.db),
		{ scanRunId: scope.scanRun.id, kind: "scan", id: "slsa-provenance" },
	);
	const artifact = await sink.saveText({
		role: "raw_result",
		format: "json",
		content: JSON.stringify(receipt, null, 2),
		metadata: {
			adapter: "slsa-verifier",
			offline: false,
			trustRootRefresh: "sigstore-tuf",
		},
	});
	const failed = !receipt.verified;
	return {
		toolResults: [],
		stepResults: [
			{
				kind: "attestation_verify",
				stepId,
				adapter: "slsa-verifier",
				required: step.required,
				status: failed ? "failed" : "completed",
				applicability: "applicable",
				reasonCode: failed ? "attestation_verification_failed" : null,
				coverageEffect: failed ? "gap" : "covered",
				findingCount: 0,
				error: failed
					? "slsa-verifier could not verify the artifact provenance against the supplied policy."
					: null,
				artifactIds: [artifact.id],
				metadata: { receipt },
			},
		],
		profileFailingToolFailed: failed && params.failureFailsProfile,
		optionalToolFailed: failed && !params.failureFailsProfile,
	};
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
