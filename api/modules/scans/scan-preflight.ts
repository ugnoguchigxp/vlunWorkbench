import type {
	ScanPreflightCheck,
	ScanPreflightMode,
	ScanPreflightResult,
} from "../../../shared/schemas/scan-preflight.schema";
import {
	SCAN_PREFLIGHT_EVIDENCE_REF_LIMIT,
	scanPreflightResultSchema,
} from "../../../shared/schemas/scan-preflight.schema";
import type {
	ScanProfile,
	ScanProfileStep,
} from "../../../shared/schemas/scan-profile.schema";
import { getDastProfile } from "../dast/profiles";
import type { DastTargetStartPlan } from "../dast/target-preparer";
import { ZAP_STABLE_IMAGE } from "../runtime-scans/zap-image-policy";
import { canonicalJson } from "./diff-scan-plan";
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
import {
	type AnyScannerE2EQualification,
	checkScannerE2EQualification,
} from "./scanner-e2e-qualification";
import { staticScannerAdapterRegistry } from "./static-scanner-adapters";
import type { ScannerDataManifest } from "./tools/scanner-provenance";
import { DEFAULT_DOCKER_IMAGE } from "./tools/tool-process-policy";
import type { ToolExecutionConfig } from "./tools/tool-process-runner";

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
	probeDockerRuntimePath: (
		dockerBin: string,
		image: string,
		runtimePath: string,
	) => Promise<boolean>;
	inferTargetPlan: (params: {
		repoPath: string;
		consentProjectCodeExecution: boolean;
	}) => Promise<DastTargetStartPlan>;
	discoverRepositorySchema: (repoPath: string) => Promise<
		| boolean
		| {
				schemaPresent: boolean;
				apiDetected: boolean;
				evidenceRefs?: string[];
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
};

function normalizeRepositorySchemaApplicability(
	discovered: Awaited<
		ReturnType<ScanPreflightDependencies["discoverRepositorySchema"]>
	>,
): RepositorySchemaApplicability {
	return typeof discovered === "boolean"
		? { schemaPresent: discovered, apiDetected: false, evidenceRefs: [] }
		: {
				schemaPresent: discovered.schemaPresent,
				apiDetected: discovered.apiDetected,
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
	targetPlan?: DastTargetStartPlan;
	/**
	 * Optional deployment-admission control. The protected CI gate is always
	 * required to produce qualification; normal project scans must not be
	 * blocked merely because their runtime lacks the CI artifact.
	 */
	requireScannerE2EQualification?: boolean;
	dependencies?: Partial<ScanPreflightDependencies>;
}): Promise<ScanPreflightResult> {
	const dependencies = {
		...defaultScanPreflightDependencies,
		...params.dependencies,
	};
	const mode = params.mode ?? resolveScanPreflightMode();
	const checks: ScanPreflightCheck[] = [];
	const sourceRevision = await dependencies.resolveSourceRevision(
		params.repoPath,
	);
	const sourceState = await dependencies.resolveSourceState(params.repoPath);
	if (params.profile.strictness === "strict") {
		const sourceReady = Boolean(sourceRevision) && sourceState === "clean";
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
				await dependencies.discoverRepositorySchema(params.repoPath),
			),
		);
	}

	const needsToolboxDocker =
		params.execution.runner === "docker" &&
		params.steps.some((step) => step.kind !== "dast");
	const zapSteps = params.steps.filter(
		(step) =>
			step.kind === "runtime_scanner" && step.adapter === "zap-baseline",
	);
	const dockerBin = params.execution.docker?.dockerBin ?? "docker";
	const toolboxImage = params.execution.docker?.image ?? DEFAULT_DOCKER_IMAGE;
	let dockerProbe: DockerProbe | null = null;
	let toolboxImageProbe: DockerImageProbe | null = null;
	let zapImageProbe: DockerImageProbe | null = null;
	if (needsToolboxDocker || zapSteps.length > 0) {
		dockerProbe = await dependencies.probeDocker(dockerBin);
		const required =
			params.steps.some(
				(step) =>
					step.required &&
					(params.execution.runner === "docker" ||
						(step.kind === "runtime_scanner" &&
							step.adapter === "zap-baseline")),
			) ?? false;
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
						(step) => step.required && step.kind !== "dast",
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
					observedDigest: toolboxImageProbe.digest,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: toolboxImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(toolboxImageProbe),
				}),
			);
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
					observedDigest: zapImageProbe.digest,
					expectedPlatform: dockerProbe.platform,
					observedPlatform: zapImageProbe.platform,
					evidenceRefs: dockerImageEvidenceRefs(zapImageProbe),
				}),
			);
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
				const consentReady =
					!targetPlan.requiresProjectCodeConsent ||
					params.consentProjectCodeExecution === true;
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
				const sandboxReady = !targetPlan.requiresProjectCodeConsent;
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
				await addScannerChecks({
					checks,
					stepId,
					required: step.required,
					scannerId,
					execution: params.execution,
					manifest,
					manifestFailure,
					dockerBin,
					toolboxImage,
					toolboxReady:
						params.execution.runner !== "docker" ||
						Boolean(
							dockerProbe &&
								toolboxImageProbe &&
								dockerImageIsCompatible(
									toolboxImageProbe,
									dockerProbe,
									digestFromImageRef(toolboxImage),
								),
						),
					dependencies,
				});
			}
		} else if (
			step.kind === "runtime_scanner" &&
			step.adapter === "nuclei-safe"
		) {
			await addScannerChecks({
				checks,
				stepId,
				required: step.required,
				scannerId: step.adapter,
				execution: params.execution,
				manifest,
				manifestFailure,
				dockerBin,
				toolboxImage,
				toolboxReady:
					params.execution.runner !== "docker" ||
					Boolean(
						dockerProbe &&
							toolboxImageProbe &&
							dockerImageIsCompatible(
								toolboxImageProbe,
								dockerProbe,
								digestFromImageRef(toolboxImage),
							),
					),
				dependencies,
			});
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
					reasonCode: applicable ? null : "schema_not_found",
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
				const version = await dependencies.probeScannerVersion(
					"schemathesis",
					params.execution,
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

	const binding = buildScanPreflightBinding({
		profile: params.profile,
		execution: params.execution,
		manifest,
		targetPlan,
		sourceRevision,
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
	const candidate = message.trim();
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
