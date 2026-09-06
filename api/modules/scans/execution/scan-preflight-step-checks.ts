import type { ScanPreflightCheck } from "../../../../shared/schemas/scan-preflight.schema";
import { getDastProfile } from "../../dast/profiles";
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
import type { resolveStaticScannerApplicability } from "../static-scanner-adapter";
import { staticScannerAdapterRegistry } from "../static-scanner-adapters";
import type { ScannerDataManifest } from "../tools/scanner-provenance";
import {
	addScannerChecks,
	buildVersionCheck,
	buildPreflightCheck as check,
	digestFromImageRef,
	scanStepId,
	stepNeedsTargetPlan,
} from "./scan-preflight-check-builders";
import {
	dockerImageIsCompatible,
	type DockerImageProbe,
	type DockerProbe,
} from "./scan-preflight-binding";
import type {
	ScanPreflightDependencies,
	ScanPreflightParams,
} from "./scan-preflight";
import type { RepositorySchemaApplicability } from "./scan-preflight-schema-applicability";
import type { DastTargetStartPlan } from "../../dast/target-preparer";

function safeReasonCode(error: unknown, fallback: string): string {
	const message = error instanceof Error ? error.message : String(error);
	const candidate = message.trim().split(":", 1)[0] ?? "";
	return /^[a-z][a-z0-9_]{2,99}$/.test(candidate) ? candidate : fallback;
}

export async function addStepPreflightChecks(input: {
	params: ScanPreflightParams;
	dependencies: ScanPreflightDependencies;
	checks: ScanPreflightCheck[];
	requiresIsolatedRuntime: boolean;
	repositorySchemas: Map<string, RepositorySchemaApplicability>;
	staticApplicabilityByStepId: Map<
		string,
		ReturnType<typeof resolveStaticScannerApplicability>
	>;
	isolatedRuntime: boolean;
	manifest: ScannerDataManifest | null;
	manifestFailure: string | null;
	dockerProbe: DockerProbe | null;
	toolboxImageProbe: DockerImageProbe | null;
	toolboxImage: string;
	profileInputBindings: Record<string, string | undefined>;
	targetPlan: DastTargetStartPlan | null;
	targetPlanFailure: string | null;
}): Promise<void> {
	const {
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
		toolboxImage,
		profileInputBindings,
		targetPlan,
		targetPlanFailure,
	} = input;
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
}
