import type {
	ScanPreflightCheck,
	ScanPreflightMode,
	ScanPreflightResult,
	ScanPreflightResultV1,
} from "../../../../shared/schemas/scan-preflight.schema";
import { scanPreflightResultSchema } from "../../../../shared/schemas/scan-preflight.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import type {
	RuntimePreflightDockerImage,
	RuntimeScannerImages,
} from "../../dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../../dast/target-preparer";
import { buildProfileInputBindings } from "../attestation/attestation-inputs";
import { loadMavenResolutionConfig } from "../maven/maven-resolution-config";
import {
	type AnyScannerE2EQualification,
	checkScannerE2EQualification,
} from "../scanner-e2e-qualification";
import { resolveStaticScannerApplicability } from "../static-scanner-adapter";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import { inspectScopedFiles } from "../target-scope";
import type { ScannerDataManifest } from "../tools/scanner-provenance";
import { DEFAULT_DOCKER_IMAGE } from "../tools/tool-process-policy";
import type { ToolExecutionConfig } from "../tools/tool-process-runner";
import { canonicalJson } from "./diff/diff-scan-plan";
import {
	buildScanPreflightBinding,
	type DockerImageProbe,
	type DockerProbe,
	hashPreflightValue,
} from "./scan-preflight-binding";
import {
	buildPreflightCheck as check,
	digestFromImageRef,
	scanStepId,
	stepNeedsTargetPlan,
} from "./scan-preflight-check-builders";
import { addDockerPreflightChecks } from "./scan-preflight-docker-checks";
import { defaultScanPreflightDependencies } from "./scan-preflight-probes";
import {
	normalizeRepositorySchemaApplicability,
	type RepositorySchemaApplicability,
} from "./scan-preflight-schema-applicability";
import { addStepPreflightChecks } from "./scan-preflight-step-checks";

export type ScanPreflightDependencies = {
	loadManifest: () => Promise<ScannerDataManifest>;
	probeScannerVersion: (
		scannerId: string,
		execution: ToolExecutionConfig,
	) => Promise<string | null>;
	probeDocker: (dockerBin: string) => Promise<DockerProbe>;
	probeDockerImage: (
		dockerBin: string,
		image: string,
	) => Promise<DockerImageProbe>;
	inferTargetPlan: (params: {
		repoPath: string;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
	discoverRepositorySchema: (
		repoPath: string,
		options?: { includeAuthenticatedOperations?: boolean },
	) => Promise<
		| boolean
		| {
				schemaPresent: boolean;
				apiDetected: boolean;
				evidenceRefs?: string[];
				reasonCode?: string | null;
		  }
	>;
	probeBrowser: () => Promise<string | null>;
	resolveSourceRevision: (repoPath: string) => Promise<string | null>;
	resolveSourceState: (
		repoPath: string,
	) => Promise<"clean" | "dirty" | "unknown">;
	loadQualification: () => Promise<AnyScannerE2EQualification | null>;
	loadQualificationContractHash: () => Promise<string | null>;
	now: () => Date;
};

export type ScanPreflightParams = {
	profile: ScanProfile;
	steps: ScanProfileStep[];
	projectId?: string;
	repoPath: string;
	execution: ToolExecutionConfig;
	mode?: ScanPreflightMode;
	consentProjectCodeExecution?: boolean;
	allowDirtySource?: boolean;
	imageRef?: string;
	imageTar?: string;
	attestationSubject?: string;
	attestationBundle?: string;
	trustPolicy?: string;
	slsaProvenance?: string;
	slsaPolicy?: string;
	authContextId?: string;
	identityRole?: string;
	dependencyResolutionMode?: "offline" | "registry";
	mavenResolverImage?: string;
	mavenResolutionConfig?: unknown;
	mavenProjectDetected?: boolean;
	/** False when a diff plan proves that OSV is not applicable to this target. */
	mavenResolutionApplicable?: boolean;
	/** Full repository inventory for full scans, or scan paths for diff scans. */
	staticScannerPaths?: readonly string[];
	targetPlan?: DastTargetStartPlan;
	/** Exact digest-pinned images used by an injected isolated runtime. */
	runtimeDockerImages?: readonly RuntimePreflightDockerImage[];
	/** Scanner-specific images used for binary and data qualification. */
	runtimeScannerImages?: RuntimeScannerImages;
	/**
	 * Runtime-capable profiles may only start a local target through the
	 * isolated runtime provider.  This is deliberately separate from a target
	 * start plan: a plan describes what may run, while the provider is the
	 * enforcement point that prevents a host-process fallback.
	 */
	isolatedRuntimeProviderAvailable?: boolean;
	/**
	 * Optional deployment-admission control. The protected CI gate is always
	 * required to produce qualification; normal project scans must not be
	 * blocked merely because their runtime lacks the CI artifact.
	 */
	requireScannerE2EQualification?: boolean;
	dependencies?: Partial<ScanPreflightDependencies>;
};

export async function runScanPreflight(
	params: ScanPreflightParams,
): Promise<ScanPreflightResultV1> {
	const dependencies = {
		...defaultScanPreflightDependencies,
		...params.dependencies,
	};
	const mode = params.mode ?? resolveScanPreflightMode();
	const checks: ScanPreflightCheck[] = [];
	const requiresIsolatedRuntime = params.steps.some(
		(step) =>
			step.kind === "runtime_scanner" ||
			step.kind === "api_schema_scan" ||
			step.kind === "dast",
	);
	if (
		requiresIsolatedRuntime &&
		params.isolatedRuntimeProviderAvailable !== undefined
	) {
		checks.push(
			check({
				id: `profile:${params.profile.id}:runtime-isolation-provider`,
				stepId: `profile:${params.profile.id}`,
				kind: "sandbox_availability",
				required: true,
				ready: params.isolatedRuntimeProviderAvailable === true,
				reasonCode:
					params.isolatedRuntimeProviderAvailable === true
						? null
						: "runtime_isolation_provider_unavailable",
				action: "configure_project_sandbox",
			}),
		);
	}
	const profileInputBindings: Record<string, string | undefined> = {
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
	};
	const needsMavenResolver =
		params.dependencyResolutionMode === "registry" &&
		params.mavenProjectDetected === true &&
		params.mavenResolutionApplicable !== false &&
		params.steps.some(
			(step) => step.kind === "static_tool" && step.toolId === "osv",
		);
	let mavenResolverInputFailure: string | null = null;
	const mavenConfigEvidence = "repository:pom.xml";
	let mavenConfigDigest: string | null = null;
	let mavenSourceDigest: string | null = null;
	if (needsMavenResolver) {
		checks.push(
			check({
				id: "static_tool:osv:maven-resolution-runner",
				stepId: "osv",
				kind: "sandbox_availability",
				required: true,
				ready: params.execution.runner === "docker",
				reasonCode:
					params.execution.runner === "docker"
						? null
						: "maven_registry_resolution_requires_docker",
				action: "use_docker_runner",
			}),
		);
		try {
			const resolved = await loadMavenResolutionConfig(
				params.repoPath,
				params.mavenResolutionConfig,
			);
			mavenConfigDigest = resolved.configDigest;
			mavenSourceDigest = resolved.sourceDigest;
			profileInputBindings.mavenResolutionConfigDigest = mavenConfigDigest;
			profileInputBindings.mavenResolutionSourceDigest = mavenSourceDigest;
		} catch (error) {
			mavenResolverInputFailure = safeReasonCode(
				error,
				"maven_resolution_config_invalid",
			);
		}
		checks.push(
			check({
				id: "static_tool:osv:maven-resolution-config",
				stepId: "osv",
				kind: "profile_input",
				required: true,
				ready: mavenResolverInputFailure === null,
				reasonCode: mavenResolverInputFailure,
				action: "provide_profile_input",
				observedDigest: mavenConfigDigest,
				evidenceRefs:
					mavenResolverInputFailure === null ? [mavenConfigEvidence] : [],
			}),
		);
		checks.push(
			check({
				id: "static_tool:osv:maven-resolution-source",
				stepId: "osv",
				kind: "profile_input",
				required: true,
				ready: mavenResolverInputFailure === null,
				reasonCode: mavenResolverInputFailure,
				action: "provide_profile_input",
				observedDigest: mavenSourceDigest,
				evidenceRefs:
					mavenSourceDigest === null
						? []
						: [`maven-resolution-source:${mavenSourceDigest}`],
			}),
		);
	}
	const sourceRevision = await dependencies.resolveSourceRevision(
		params.repoPath,
	);
	const sourceState = await dependencies.resolveSourceState(params.repoPath);
	if (params.profile.strictness === "strict") {
		const sourceReady =
			Boolean(sourceRevision) &&
			(sourceState === "clean" ||
				(params.allowDirtySource === true && sourceState === "dirty"));
		checks.push(
			check({
				id: `profile:${params.profile.id}:source-revision`,
				stepId: `profile:${params.profile.id}`,
				kind: "source_revision",
				required: true,
				ready: sourceReady,
				reasonCode: !sourceRevision
					? "source_revision_unavailable"
					: sourceState === "dirty"
						? "source_worktree_dirty"
						: "source_state_unknown",
				action: "commit_or_clean_worktree",
				evidenceRefs: sourceRevision
					? [`source-revision:${sourceRevision}`]
					: [],
			}),
		);
	}
	let manifest: ScannerDataManifest | null = null;
	let manifestFailure: string | null = null;
	try {
		manifest = await dependencies.loadManifest();
	} catch {
		manifestFailure = "scanner_data_manifest_invalid";
	}
	// API-schema scans do not need a target plan until a repository schema is
	// present. Resolve this before target planning so an API-without-schema
	// strict preview is genuinely process-free, and a non-API library can be
	// classified N/A without requiring an invented start command.
	const repositorySchemas = new Map<string, RepositorySchemaApplicability>();
	for (const step of params.steps) {
		if (step.kind !== "api_schema_scan") continue;
		repositorySchemas.set(
			scanStepId(step),
			normalizeRepositorySchemaApplicability(
				await dependencies.discoverRepositorySchema(params.repoPath, {
					includeAuthenticatedOperations: Boolean(params.authContextId),
				}),
			),
		);
	}

	const isolatedRuntime = params.isolatedRuntimeProviderAvailable === true;
	const staticApplicabilityByStepId = new Map<
		string,
		ReturnType<typeof resolveStaticScannerApplicability>
	>();
	if (params.staticScannerPaths) {
		for (const step of params.steps) {
			if (
				step.kind !== "static_tool" &&
				step.kind !== "sbom_export" &&
				step.kind !== "container_image_scan"
			) {
				continue;
			}
			const scannerId = step.kind === "static_tool" ? step.toolId : "trivy";
			const adapter = staticScannerAdapterRegistry.get(scannerId);
			if (!adapter?.resolveApplicability) continue;
			staticApplicabilityByStepId.set(
				scanStepId(step),
				resolveStaticScannerApplicability(adapter, params.staticScannerPaths),
			);
		}
	}
	const stepIsApplicable = (step: ScanProfileStep) =>
		staticApplicabilityByStepId.get(scanStepId(step))?.applicability !==
		"not_applicable";
	const isolatedStepFallsBackToToolbox = (step: ScanProfileStep) =>
		isolatedRuntime &&
		((step.kind === "runtime_scanner" &&
			step.adapter === "nuclei-safe" &&
			!params.runtimeScannerImages?.["nuclei-safe"]) ||
			(step.kind === "api_schema_scan" &&
				repositorySchemas.get(scanStepId(step))?.schemaPresent === true &&
				!params.runtimeScannerImages?.schemathesis));
	const needsToolboxDocker =
		params.execution.runner === "docker" &&
		params.steps.some(
			(step) =>
				stepIsApplicable(step) &&
				step.kind !== "dast" &&
				(!isolatedRuntime ||
					step.kind === "static_tool" ||
					step.kind === "sbom_export" ||
					step.kind === "container_image_scan" ||
					step.kind === "attestation_verify" ||
					isolatedStepFallsBackToToolbox(step)),
		);
	const zapSteps = params.steps.filter(
		(step) =>
			step.kind === "runtime_scanner" &&
			step.adapter === "zap-baseline" &&
			(!isolatedRuntime || !params.runtimeScannerImages?.["zap-baseline"]),
	);
	const runtimeDockerImages = (params.runtimeDockerImages ?? []).filter(
		(image) =>
			!image.stepId.startsWith("api_schema_scan:") ||
			[...repositorySchemas.entries()].some(
				([stepId, applicability]) =>
					stepId === image.stepId && applicability.schemaPresent,
			),
	);
	const { dockerProbe, toolboxImageProbe } = await addDockerPreflightChecks({
		params,
		dependencies,
		checks,
		needsToolboxDocker,
		needsMavenResolver,
		zapSteps,
		isolatedRuntime,
		runtimeDockerImages,
		stepIsApplicable,
		profileInputBindings,
	});

	let targetPlan: DastTargetStartPlan | null = null;
	let targetPlanFailure: string | null = null;
	if (
		params.steps.some(
			(step) =>
				stepNeedsTargetPlan(step) &&
				(step.kind !== "api_schema_scan" ||
					repositorySchemas.get(scanStepId(step))?.schemaPresent === true),
		)
	) {
		try {
			targetPlan =
				params.targetPlan ??
				(await dependencies.inferTargetPlan({
					repoPath: params.repoPath,
					consentProjectCodeExecution:
						params.consentProjectCodeExecution === true,
				}));
		} catch (error) {
			targetPlanFailure = safeReasonCode(
				error,
				"target_start_plan_unavailable",
			);
		}
	}

	await addStepPreflightChecks({
		params,
		dependencies,
		checks,
		requiresIsolatedRuntime,
		repositorySchemas,
		staticApplicabilityByStepId,
		isolatedRuntime,
		manifest,
		manifestFailure,
		dockerProbe,
		toolboxImageProbe,
		toolboxImage: params.execution.docker?.image ?? DEFAULT_DOCKER_IMAGE,
		profileInputBindings,
		targetPlan,
		targetPlanFailure,
	});

	if (
		params.profile.scope?.intent === "artifact" &&
		!params.imageRef &&
		!params.imageTar
	) {
		const artifactScope = await inspectScopedFiles({
			repoPath: params.repoPath,
			scope: params.profile.scope,
		});
		checks.push(
			check({
				id: `profile:${params.profile.id}:artifact-input`,
				stepId: `profile:${params.profile.id}`,
				kind: "profile_input",
				required: true,
				ready: artifactScope.fileCount > 0,
				reasonCode:
					artifactScope.fileCount > 0 ? null : "artifact_input_missing",
				action: "provide_profile_input",
				evidenceRefs:
					artifactScope.fileCount > 0
						? [`artifact-scope:${artifactScope.digest}`]
						: [],
			}),
		);
	}
	if (params.imageRef || params.imageTar) {
		let imageInputFailure: string | null = null;
		if (params.imageRef && !digestFromImageRef(params.imageRef)) {
			imageInputFailure = "image_digest_required";
		} else if (params.imageTar) {
			try {
				Object.assign(
					profileInputBindings,
					await buildProfileInputBindings({
						repoPath: params.repoPath,
						imageTar: params.imageTar,
					}),
				);
			} catch (error) {
				imageInputFailure = safeReasonCode(error, "image_tar_input_invalid");
			}
		}
		checks.push(
			check({
				id: `profile:${params.profile.id}:image-input`,
				stepId: `profile:${params.profile.id}`,
				kind: "profile_input",
				required: true,
				ready: imageInputFailure === null,
				reasonCode: imageInputFailure,
				action: "provide_profile_input",
			}),
		);
	}

	const binding = buildScanPreflightBinding({
		profile: params.profile,
		execution: params.execution,
		manifest,
		targetPlan,
		sourceRevision,
		profileInputs: profileInputBindings,
		checks,
	});
	const requireScannerE2EQualification =
		params.requireScannerE2EQualification ??
		process.env.VULN_WORKBENCH_REQUIRE_SCANNER_E2E_QUALIFICATION === "true";
	if (
		params.profile.strictness === "strict" &&
		requireScannerE2EQualification
	) {
		const [qualification, expectedContractHash] = await Promise.all([
			dependencies.loadQualification(),
			dependencies.loadQualificationContractHash(),
		]);
		const qualificationCheck = checkScannerE2EQualification({
			qualification,
			steps: params.steps,
			preflight: { binding, checks },
			expectedContractHash,
		});
		checks.push(
			check({
				id: `profile:${params.profile.id}:scanner-e2e-qualification`,
				stepId: `profile:${params.profile.id}`,
				kind: "scanner_e2e_qualification",
				required: true,
				ready: qualificationCheck.ready,
				reasonCode: qualificationCheck.reasonCode,
				action: "run_scanner_e2e_qualification",
				evidenceRefs: qualificationCheck.evidenceRefs,
			}),
		);
	}
	const blocked = checks.filter((item) => item.status === "blocked");
	const status = blocked.some((item) => item.required)
		? "blocked"
		: blocked.length > 0
			? "ready_with_gaps"
			: "ready";
	const limitationCodes = [
		...new Set(blocked.flatMap((item) => item.reasonCode ?? [])),
	].sort();
	const summary = {
		ready: checks.filter((item) => item.status === "ready").length,
		blockedRequired: blocked.filter((item) => item.required).length,
		blockedOptional: blocked.filter((item) => !item.required).length,
		notApplicable: checks.filter((item) => item.status === "not_applicable")
			.length,
	};
	const partial = {
		schemaVersion: 1 as const,
		projectId: params.projectId ?? null,
		profileId: params.profile.id,
		sourceRevision,
		sourceState,
		mode,
		status,
		createdAt: dependencies.now().toISOString(),
		checks,
		summary,
		limitationCodes,
		binding,
		bindingHash: hashPreflightValue(canonicalJson(binding)),
	};
	return scanPreflightResultSchema.parse({
		...partial,
		preflightHash: hashPreflightValue(canonicalJson(partial)),
	});
}

function safeReasonCode(error: unknown, fallback: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const candidate = message.trim().split(":", 1)[0] ?? "";
	return /^[a-z][a-z0-9_]{2,99}$/.test(candidate) ? candidate : fallback;
}

export function resolveScanPreflightMode(
	value = process.env.VULN_WORKBENCH_SCAN_PREFLIGHT_MODE,
): ScanPreflightMode {
	// Production must fail closed. Shadow mode remains an explicit diagnostic
	// opt-in; strict profiles are additionally enforced by the orchestrator.
	return value === "shadow" ? "shadow" : "enforced";
}

export function readStoredScanPreflight(
	metadata: Record<string, unknown> | null | undefined,
): ScanPreflightResult | null {
	const parsed = scanPreflightResultSchema.safeParse(metadata?.scanPreflight);
	return parsed.success ? parsed.data : null;
}

export function preflightBlocksExecution(result: ScanPreflightResult): boolean {
	return result.mode === "enforced" && result.status === "blocked";
}
