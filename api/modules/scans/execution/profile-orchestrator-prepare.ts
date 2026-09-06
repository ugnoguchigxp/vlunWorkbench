import type { ScanTarget } from "../../../../shared/schemas/scan-target.schema";
import { resolveProjectPath } from "../../../security/project-path-policy";
import { analyzeProjectCapabilities } from "../../project-capabilities/plugin-detector";
import { resolveSourceSastCoverage } from "../coverage/source-sast-coverage";
import {
	normalizeProfileResolutionInput,
	resolveProfileSelection,
} from "../profile-resolution";
import { ArtifactRepository, ScanRepository } from "../repositories";
import { resolveScanScope } from "../target-scope";
import { normalizeToolExecutionConfig } from "../tools/tool-process-runner";
import { buildDiffScanPlan, type DiffScanPlan } from "./diff/diff-scan-plan";
import {
	GitDiffResolutionError,
	resolveGitDiff,
} from "./diff/git-diff-resolver";
import { resolveFullScanTarget } from "./full-scan-target";
import { ArtifactStorage } from "./lifecycle/artifact-storage";
import type { ProfileOrchestratorParams } from "./profile-orchestrator";
import { resolveProfileSteps } from "./profile-runner";
import { hashResolvedProfile } from "./resolved-profile";
import { applyStrictProfileRequirements } from "./scan-execution-plan-builder";

export async function prepareProfileScan(params: ProfileOrchestratorParams) {
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
			slsaProvenance: params.slsaProvenance,
			slsaPolicy: params.slsaPolicy,
			authContextRef: params.authContextId,
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
	const mavenProjectDetected =
		technologyAnalysis.capabilityPlan.activePluginIds.includes("build.maven");
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
	const mavenResolutionApplicable =
		diffPlan?.tools.find((tool) => tool.toolId === "osv")?.applicability !==
		"not_applicable";
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
		dependencyResolution: {
			mode: params.dependencyResolutionMode ?? "offline",
			mavenProjectDetected,
		},
	};
	return {
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
		initialSourceSastCoverage,
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
	};
}
