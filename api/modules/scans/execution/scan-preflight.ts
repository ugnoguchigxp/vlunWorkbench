import type {
	ScanPreflightCheck,
	ScanPreflightMode,
	ScanPreflightResult,
	ScanPreflightResultV1,
} from "../../../../shared/schemas/scan-preflight.schema";
import {
	SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT,
	scanPreflightResultSchema,
} from "../../../../shared/schemas/scan-preflight.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../../shared/schemas/scan-profile.schema";
import { getDastProfile } from "../../dast/profiles";
import type {
	RuntimePreflightDockerImage,
	RuntimeScannerImages,
} from "../../dast/runtime-target-provider";
import type { DastTargetStartPlan } from "../../dast/target-preparer";
import { ZAP_STABLE_IMAGE } from "../../runtime-scans/zap-image-policy";
import {
	buildProfileInputBindings,
	resolveSlsaProvenanceInputPaths,
} from "../attestation/attestation-inputs";
import {
	COSIGN_SAFE_VERSION_REQUIREMENT,
	isCosignVersionSafe,
	parseCosignVersion,
} from "../attestation/cosign-attestation-provider";
import {
	loadSlsaProvenancePolicy,
	parseSlsaVerifierVersion,
	SLSA_VERIFIER_VERSION,
} from "../attestation/slsa-provenance-provider";
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
	dockerImageEvidenceRefs,
	dockerImageIsCompatible,
	dockerImageReason,
	hashPreflightValue,
} from "./scan-preflight-binding";
import {
	addScannerChecks,
	buildVersionCheck,
	buildPreflightCheck as check,
	digestFromImageRef,
	scanStepId,
	stepNeedsTargetPlan,
} from "./scan-preflight-check-builders";
import { defaultScanPreflightDependencies } from "./scan-preflight-probes";

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

type RepositorySchemaApplicability = {
	schemaPresent: boolean;
	apiDetected: boolean;
	evidenceRefs: string[];
	reasonCode: string | null;
};

function normalizeRepositorySchemaApplicability(
	discovered: Awaited<
		ReturnType<ScanPreflightDependencies["discoverRepositorySchema"]>
	>,
): RepositorySchemaApplicability {
	return typeof discovered === "boolean"
		? {
				schemaPresent: discovered,
				apiDetected: false,
				evidenceRefs: [],
				reasonCode: discovered ? null : "schema_not_found",
			}
		: {
				schemaPresent: discovered.schemaPresent,
				apiDetected: discovered.apiDetected,
				reasonCode: discovered.reasonCode ?? null,
				evidenceRefs: (discovered.evidenceRefs ?? []).slice(
					0,
					SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT,
				),
			};
}

export async function runScanPreflight(params: {
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
}): Promise<ScanPreflightResultV1> {
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
					step.kind === "attestation_verify"),
		);
	const zapSteps = params.steps.filter(
		(step) =>
			!isolatedRuntime &&
			step.kind === "runtime_scanner" &&
			step.adapter === "zap-baseline",
	);
	const runtimeDockerImages = (params.runtimeDockerImages ?? []).filter(
		(image) =>
			!image.stepId.startsWith("api_schema_scan:") ||
			[...repositorySchemas.entries()].some(
				([stepId, applicability]) =>
					stepId === image.stepId && applicability.schemaPresent,
			),
	);
	const dockerBin = params.execution.docker?.dockerBin ?? "docker";
	const toolboxImage = params.execution.docker?.image ?? DEFAULT_DOCKER_IMAGE;
	let dockerProbe: DockerProbe | null = null;
	let toolboxImageProbe: DockerImageProbe | null = null;
	let zapImageProbe: DockerImageProbe | null = null;
	if (
		needsToolboxDocker ||
		needsMavenResolver ||
		zapSteps.length > 0 ||
		isolatedRuntime ||
		runtimeDockerImages.length > 0
	) {
		dockerProbe = await dependencies.probeDocker(dockerBin);
		const required =
			needsMavenResolver ||
			params.steps.some(
				(step) =>
					step.required &&
					stepIsApplicable(step) &&
					(params.execution.runner === "docker" ||
						(step.kind === "runtime_scanner" &&
							step.adapter === "zap-baseline")),
			) ||
			runtimeDockerImages.some((image) => image.required);
		checks.push(
			check({
				id: "runtime:docker-daemon",
				stepId: `profile:${params.profile.id}`,
				kind: "docker_daemon",
				required,
				ready: dockerProbe.ready,
				reasonCode: dockerProbe.reasonCode,
				action: "start_docker_daemon",
				observedVersion: dockerProbe.version,
				observedPlatform: dockerProbe.platform,
				evidenceRefs: dockerProbe.version ? ["runtime:docker-daemon"] : [],
			}),
		);
		if (dockerProbe.ready && needsToolboxDocker) {
			toolboxImageProbe = await dependencies.probeDockerImage(
				dockerBin,
				toolboxImage,
			);
			checks.push(
				check({
					id: "runtime:docker-image:toolbox",
					stepId: `profile:${params.profile.id}`,
					kind: "docker_image",
					required: params.steps.some(
						(step) =>
							step.required && stepIsApplicable(step) && step.kind !== "dast",
					),
					ready: dockerImageIsCompatible(
						toolboxImageProbe,
						dockerProbe,
						digestFromImageRef(toolboxImage),
					),
					reasonCode: dockerImageReason(
						toolboxImageProbe,
						dockerProbe,
						digestFromImageRef(toolboxImage),
					),
					action: "build_toolbox_image",
					expectedDigest: digestFromImageRef(toolboxImage),
					observedDigest:
						toolboxImageProbe.digest ?? toolboxImageProbe.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: toolboxImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(toolboxImageProbe),
				}),
			);
		}
		if (dockerProbe.ready && needsMavenResolver) {
			const resolverImage = params.mavenResolverImage;
			const resolverImageProbe = resolverImage
				? await dependencies.probeDockerImage(dockerBin, resolverImage)
				: null;
			const expectedDigest = resolverImage
				? digestFromImageRef(resolverImage)
				: null;
			const ready = Boolean(
				resolverImage &&
					resolverImageProbe?.imageId &&
					dockerImageIsCompatible(
						resolverImageProbe,
						dockerProbe,
						expectedDigest,
					),
			);
			checks.push(
				check({
					id: "runtime:docker-image:maven-resolver",
					stepId: "osv",
					kind: "docker_image",
					required: true,
					ready,
					reasonCode: !resolverImage
						? "maven_resolver_image_not_configured"
						: resolverImageProbe && !resolverImageProbe.imageId
							? "maven_resolver_image_id_unavailable"
							: resolverImageProbe
								? dockerImageReason(
										resolverImageProbe,
										dockerProbe,
										expectedDigest,
									)
								: "maven_resolver_image_unavailable",
					action: "build_maven_resolver_image",
					expectedDigest,
					observedDigest:
						resolverImageProbe?.digest ?? resolverImageProbe?.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: resolverImageProbe?.platform ?? null,
					evidenceRefs: resolverImageProbe
						? dockerImageEvidenceRefs(resolverImageProbe)
						: [],
				}),
			);
			if (resolverImageProbe?.imageId) {
				profileInputBindings.mavenResolverImageId = resolverImageProbe.imageId;
			}
		}
		if (dockerProbe.ready && zapSteps.length > 0) {
			zapImageProbe = await dependencies.probeDockerImage(
				dockerBin,
				ZAP_STABLE_IMAGE,
			);
			checks.push(
				check({
					id: "runtime:docker-image:zap-baseline",
					stepId: "runtime_scanner:zap-baseline",
					kind: "docker_image",
					required: zapSteps.some((step) => step.required),
					ready: dockerImageIsCompatible(
						zapImageProbe,
						dockerProbe,
						digestFromImageRef(ZAP_STABLE_IMAGE),
					),
					reasonCode: dockerImageReason(
						zapImageProbe,
						dockerProbe,
						digestFromImageRef(ZAP_STABLE_IMAGE),
					),
					action: "pull_pinned_image",
					expectedDigest: digestFromImageRef(ZAP_STABLE_IMAGE),
					observedDigest: zapImageProbe.digest ?? zapImageProbe.imageId ?? null,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: zapImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(zapImageProbe),
				}),
			);
		}
		if (dockerProbe.ready && runtimeDockerImages.length > 0) {
			const probes = new Map<string, DockerImageProbe>();
			for (const runtimeImage of runtimeDockerImages) {
				const expectedDigest = runtimeImage.image
					? digestFromImageRef(runtimeImage.image)
					: null;
				let imageProbe: DockerImageProbe | null = null;
				if (runtimeImage.image) {
					imageProbe = probes.get(runtimeImage.image) ?? null;
					if (!imageProbe) {
						imageProbe = await dependencies.probeDockerImage(
							dockerBin,
							runtimeImage.image,
						);
						probes.set(runtimeImage.image, imageProbe);
					}
				}
				const ready = Boolean(
					imageProbe &&
						dockerImageIsCompatible(imageProbe, dockerProbe, expectedDigest),
				);
				checks.push(
					check({
						id: `runtime:docker-image:isolated:${runtimeImage.role}`,
						stepId: runtimeImage.stepId,
						kind: "docker_image",
						required: runtimeImage.required,
						ready,
						reasonCode: imageProbe
							? dockerImageReason(imageProbe, dockerProbe, expectedDigest)
							: "runtime_image_missing",
						action: "pull_pinned_image",
						expectedDigest,
						observedDigest: imageProbe?.digest ?? imageProbe?.imageId ?? null,
						expectedPlatform: dockerProbe.platform,
						observedPlatform: imageProbe?.platform ?? null,
						evidenceRefs: imageProbe ? dockerImageEvidenceRefs(imageProbe) : [],
					}),
				);
			}
		}
	}

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

	for (const step of params.steps) {
		const stepId = scanStepId(step);
		const requiresTargetPlan =
			stepNeedsTargetPlan(step) &&
			(step.kind !== "api_schema_scan" ||
				repositorySchemas.get(stepId)?.schemaPresent === true);
		if (requiresTargetPlan) {
			checks.push(
				check({
					id: `${stepId}:target-start-plan`,
					stepId,
					kind: "target_start_plan",
					required: step.required,
					ready: Boolean(targetPlan),
					reasonCode: targetPlanFailure,
					action: "configure_target_start_plan",
				}),
			);
			if (targetPlan) {
				const isolatedRuntimeTarget =
					requiresIsolatedRuntime &&
					params.isolatedRuntimeProviderAvailable === true;
				const consentRequired =
					targetPlan.requiresProjectCodeConsent || isolatedRuntimeTarget;
				const consentReady =
					!consentRequired || params.consentProjectCodeExecution === true;
				checks.push(
					check({
						id: `${stepId}:project-code-consent`,
						stepId,
						kind: "project_code_consent",
						required: step.required,
						ready: consentReady,
						reasonCode: consentReady
							? null
							: "project_code_execution_consent_required",
						action: "grant_project_code_consent",
					}),
				);
				const sandboxReady =
					isolatedRuntimeTarget || !targetPlan.requiresProjectCodeConsent;
				checks.push(
					check({
						id: `${stepId}:sandbox`,
						stepId,
						kind: "sandbox_availability",
						required: step.required,
						ready: sandboxReady,
						reasonCode: sandboxReady
							? null
							: "project_code_execution_sandbox_required",
						action: "configure_project_sandbox",
					}),
				);
			}
		}
		if (
			step.kind === "static_tool" ||
			step.kind === "sbom_export" ||
			step.kind === "container_image_scan"
		) {
			const scannerId = step.kind === "static_tool" ? step.toolId : "trivy";
			const adapter = staticScannerAdapterRegistry.get(scannerId);
			checks.push(
				check({
					id: `${stepId}:adapter`,
					stepId,
					kind: "adapter_registration",
					required: step.required,
					ready: Boolean(adapter),
					reasonCode: adapter ? null : "scanner_adapter_not_registered",
					action: "configure_scanner_adapter",
					scannerId,
				}),
			);
			if (adapter) {
				const applicability = staticApplicabilityByStepId.get(stepId) ?? null;
				if (applicability && adapter.resolveApplicability) {
					checks.push({
						id: `${stepId}:applicability`,
						stepId,
						kind: "scanner_applicability",
						required: step.required,
						status:
							applicability.applicability === "applicable"
								? "ready"
								: "not_applicable",
						reasonCode: applicability.reasonCode,
						action: null,
						scannerId,
						observedVersion: null,
						expectedVersion: null,
						expectedDigest: null,
						observedDigest: null,
						dataState: null,
						dataGeneratedAt: null,
						evidenceRefs: applicability.evidenceRefs ?? [],
					});
					if (applicability.applicability === "not_applicable") continue;
				}
				await addScannerChecks({
					checks,
					stepId,
					required: step.required,
					scannerId,
					execution: params.execution,
					manifest,
					manifestFailure,
					dependencies,
				});
			}
		} else if (
			step.kind === "runtime_scanner" &&
			step.adapter === "nuclei-safe"
		) {
			const runtimeImage = isolatedRuntime
				? params.runtimeScannerImages?.[step.adapter]
				: undefined;
			const scannerExecution = isolatedRuntime
				? {
						...params.execution,
						runner: "docker" as const,
						docker: {
							...params.execution.docker,
							image: runtimeImage ?? toolboxImage,
						},
					}
				: params.execution;
			await addScannerChecks({
				checks,
				stepId,
				required: step.required,
				scannerId: step.adapter,
				execution: scannerExecution,
				manifest,
				manifestFailure,
				dependencies,
			});
		} else if (step.kind === "attestation_verify") {
			let inputFailure: string | null = null;
			try {
				if (!params.attestationSubject)
					throw new Error("attestation_input_missing");
				if (step.adapter === "cosign") {
					if (!params.attestationBundle || !params.trustPolicy) {
						throw new Error("attestation_input_missing");
					}
				} else {
					if (!params.slsaProvenance || !params.slsaPolicy) {
						throw new Error("attestation_input_missing");
					}
					const paths = await resolveSlsaProvenanceInputPaths({
						repoPath: params.repoPath,
						subject: params.attestationSubject,
						provenance: params.slsaProvenance,
						policy: params.slsaPolicy,
					});
					await loadSlsaProvenancePolicy(paths.policyPath);
				}
				Object.assign(
					profileInputBindings,
					await buildProfileInputBindings({
						repoPath: params.repoPath,
						attestationSubject: params.attestationSubject,
						attestationBundle: params.attestationBundle,
						trustPolicy: params.trustPolicy,
						slsaProvenance: params.slsaProvenance,
						slsaPolicy: params.slsaPolicy,
					}),
				);
			} catch (error) {
				inputFailure = safeReasonCode(error, "attestation_input_invalid");
			}
			checks.push(
				check({
					id: `${stepId}:profile-input`,
					stepId,
					kind: "profile_input",
					required: step.required,
					ready: inputFailure === null,
					reasonCode: inputFailure,
					action: "provide_profile_input",
				}),
			);
			const attestationToolboxReady =
				params.execution.runner !== "docker" ||
				Boolean(
					dockerProbe &&
						toolboxImageProbe &&
						dockerImageIsCompatible(
							toolboxImageProbe,
							dockerProbe,
							digestFromImageRef(toolboxImage),
						),
				);
			if (attestationToolboxReady) {
				const scannerId = step.adapter;
				if (step.adapter === "cosign") {
					const entry = manifest?.tools.cosign;
					const dataReady = Boolean(entry && entry.state === "ready");
					let reasonCode = manifestFailure;
					if (!reasonCode && !entry) reasonCode = "scanner_data_entry_missing";
					if (!reasonCode && entry?.state === "missing")
						reasonCode = "scanner_data_missing";
					if (!reasonCode && entry?.state === "stale")
						reasonCode = "scanner_data_stale";
					checks.push(
						check({
							id: `${stepId}:scanner-data`,
							stepId,
							kind: "scanner_data",
							required: step.required,
							ready: dataReady,
							reasonCode,
							action: "prepare_scanner_database",
							scannerId,
							expectedVersion: entry?.version ?? null,
							expectedDigest: entry?.digest ?? null,
							observedDigest: dataReady ? (entry?.digest ?? null) : null,
							dataState: entry?.state ?? null,
							dataGeneratedAt: entry?.generatedAt ?? null,
							evidenceRefs: manifest
								? [`scanner-manifest:${manifest.manifestHash}`]
								: [],
						}),
					);
				}
				if (params.execution.runner !== "docker") {
					const version = await dependencies.probeScannerVersion(
						scannerId,
						params.execution,
					);
					const versionReady =
						step.adapter === "cosign"
							? isCosignVersionSafe(version)
							: parseSlsaVerifierVersion(version) === SLSA_VERIFIER_VERSION;
					const observedSemanticVersion =
						step.adapter === "cosign"
							? parseCosignVersion(version)?.join(".")
							: parseSlsaVerifierVersion(version);
					checks.push(
						check({
							id: `${stepId}:binary-version`,
							stepId,
							kind: "binary_version",
							required: step.required,
							ready: versionReady,
							reasonCode: version
								? "scanner_version_vulnerable"
								: "scanner_binary_unavailable",
							action: "build_toolbox_image",
							scannerId,
							observedVersion: observedSemanticVersion ?? version,
							expectedVersion:
								step.adapter === "cosign"
									? COSIGN_SAFE_VERSION_REQUIREMENT
									: SLSA_VERIFIER_VERSION,
							evidenceRefs: version ? [`scanner-version:${scannerId}`] : [],
						}),
					);
				}
			}
			if (
				step.adapter === "slsa-verifier" &&
				params.execution.runner === "docker"
			) {
				const networkReady = params.execution.docker?.networkMode === "default";
				checks.push(
					check({
						id: `${stepId}:sigstore-trust-root-network`,
						stepId,
						kind: "runtime_network_isolation",
						required: step.required,
						ready: networkReady,
						reasonCode: networkReady
							? null
							: "slsa_trust_root_network_required",
						action: "allow_slsa_trust_root_network",
						evidenceRefs: ["network:sigstore-tuf"],
					}),
				);
			}
		} else if (step.kind === "api_schema_scan") {
			const schema = repositorySchemas.get(stepId);
			if (!schema) throw new Error(`api_schema_discovery_missing:${stepId}`);
			const applicable = schema.schemaPresent;
			const missingSchemaForDetectedApi =
				!applicable &&
				schema.apiDetected &&
				params.profile.strictness === "strict";
			checks.push({
				...check({
					id: `${stepId}:schema`,
					stepId,
					kind: "api_schema_applicability",
					required:
						step.required && (applicable || missingSchemaForDetectedApi),
					ready: applicable,
					reasonCode: applicable
						? null
						: (schema.reasonCode ?? "schema_not_found"),
					action: "configure_api_schema",
					evidenceRefs: schema.evidenceRefs,
				}),
				status: applicable
					? "ready"
					: missingSchemaForDetectedApi
						? "blocked"
						: "not_applicable",
			});
			if (applicable) {
				const runtimeImage = isolatedRuntime
					? params.runtimeScannerImages?.schemathesis
					: undefined;
				const scannerExecution = runtimeImage
					? {
							...params.execution,
							runner: "docker" as const,
							docker: { ...params.execution.docker, image: runtimeImage },
						}
					: params.execution;
				if (scannerExecution.runner !== "docker") {
					const version = await dependencies.probeScannerVersion(
						"schemathesis",
						scannerExecution,
					);
					checks.push(
						buildVersionCheck(
							stepId,
							step.required,
							"schemathesis",
							version,
							null,
						),
					);
				}
			}
		} else if (step.kind === "dast") {
			const dastProfile = getDastProfile(step.profileId);
			if (dastProfile?.kind === "browser") {
				const browserVersion = await dependencies.probeBrowser();
				checks.push(
					check({
						id: `${stepId}:browser`,
						stepId,
						kind: "browser_runtime",
						required: step.required,
						ready: Boolean(browserVersion),
						reasonCode: browserVersion
							? null
							: "playwright_browser_unavailable",
						action: "install_playwright_browser",
						observedVersion: browserVersion,
					}),
				);
			}
		}
	}
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
